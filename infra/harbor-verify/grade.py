"""Grades one Harbor bundle inside the praxis-harbor-verify Cloud Run job.

    grade.py <bundle-ref> <null-agent|oracle> <result-key>

The job's service account has no storage access. The worker passes a short-lived signed GET URL for the bundle and a
signed PUT URL for the result (PRAXIS_BUNDLE_URL, PRAXIS_RESULT_URL). This process (root) downloads and unpacks the
bundle, then forks the grader, which leaves the network namespace, drops to nobody and gets a clean environment, so
task code can reach neither the network nor the signed URLs. The score is the reward the verifiers write
(logs/verifier/reward.txt), as in prisma/catalog/verify-docker.ts.
"""

import gzip
import io
import json
import os
import resource
import shutil
import signal
import stat
import sys
import tarfile
import time
import urllib.request

NOBODY = 65534
TASK = "/tmp/task"
HOME = "/tmp/home"
MAX_BUNDLE_BYTES = 50 * 1024 * 1024
MAX_FILES = 2000
MAX_OUTPUT_CHARS = 150_000
MAX_LOG_CHARS = 200_000
GRADE_SECONDS = int(os.environ.get("HARBOR_GRADE_SECONDS", "120"))
# The judge's checklists are graded by Praxis after the run; they are not needed here.
DROPPED_PREFIXES = ("eval/judge/",)
WRITABLE_DIRS = ("workspace/outputs", "var/lib/harbor", "logs/verifier")
PYTEST_INI = "/opt/grade/pytest.ini"
REWARD = os.path.join(TASK, "logs/verifier/reward.txt")


class GradeError(Exception):
    pass


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        data = r.read(MAX_BUNDLE_BYTES + 1)
    if len(data) > MAX_BUNDLE_BYTES:
        raise GradeError("bundle is larger than %d bytes" % MAX_BUNDLE_BYTES)
    return data


def safe_member_path(name):
    parts = name.split("/")
    if name.startswith("/") or ".." in parts or "" in parts or "\\" in name:
        raise GradeError("unsafe path in bundle: %r" % name)
    return name


def unpack(data, root):
    """Regular files only; no links, devices or paths outside root. Directories are root-owned and read-only."""
    os.makedirs(root, mode=0o755)
    count = 0
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(data)), mode="r:") as tar:
        for m in tar:
            if m.isdir():
                continue
            if not m.isreg():
                raise GradeError("bundle entry is not a regular file: %r" % m.name)
            name = safe_member_path(m.name)
            if name.startswith(DROPPED_PREFIXES):
                continue
            count += 1
            if count > MAX_FILES:
                raise GradeError("bundle has more than %d files" % MAX_FILES)
            target = os.path.join(root, name)
            os.makedirs(os.path.dirname(target), mode=0o755, exist_ok=True)
            with open(target, "xb") as f:
                f.write(tar.extractfile(m).read())
            os.chmod(target, 0o755 if m.mode & 0o111 else 0o644)
    for d in WRITABLE_DIRS:
        path = os.path.join(root, d)
        os.makedirs(path, mode=0o755, exist_ok=True)
        os.chown(path, NOBODY, NOBODY)
    os.makedirs(HOME, mode=0o700, exist_ok=True)
    os.chown(HOME, NOBODY, NOBODY)


def leave_network():
    """New empty network namespace (only a down loopback). Returns how isolation was achieved, or raises."""
    try:
        os.unshare(os.CLONE_NEWNET)
        return "netns"
    except OSError as e:
        first = e
    try:
        os.unshare(os.CLONE_NEWUSER | os.CLONE_NEWNET)
        return "userns+netns"
    except OSError as e:
        raise GradeError("cannot isolate the network (%s; %s)" % (first, e))


def as_nobody(require_netns):
    """In a forked child: own session, empty network namespace, nobody with no groups, resource limits."""
    os.setsid()
    try:
        how = leave_network()
    except GradeError as e:
        if require_netns:
            raise
        how = "none (%s)" % e
    os.setgroups([])
    os.setgid(NOBODY)
    os.setuid(NOBODY)
    if os.getuid() != NOBODY or os.geteuid() != NOBODY:
        raise GradeError("could not drop privileges")
    resource.setrlimit(resource.RLIMIT_CPU, (GRADE_SECONDS, GRADE_SECONDS))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return how


def task_env():
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": HOME,
        "LANG": "C.UTF-8",
        "HARBOR_ROOT": TASK,
        "HARBOR_REWARD_PATH": REWARD,
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
    }


def phase(script, require_netns, seconds):
    """Runs `sh -c script` as nobody in the task dir; returns (log, exit code, timed out)."""
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:
        try:
            os.close(r)
            os.dup2(w, 1)
            os.dup2(w, 2)
            os.close(w)
            how = as_nobody(require_netns)
            os.chdir(TASK)
            sys.stdout.write("isolation: network=%s uid=%d\n" % (how, os.getuid()))
            sys.stdout.flush()
            os.execve("/bin/sh", ["sh", "-c", script], task_env())
        except BaseException as e:  # noqa: BLE001 - report and exit without running task code
            sys.stdout.write("grader setup failed: %s\n" % e)
            sys.stdout.flush()
        os._exit(97)
    os.close(w)
    chunks, size, timed_out, status = [], 0, False, None
    deadline = time.monotonic() + seconds
    drain_until = None
    os.set_blocking(r, False)
    while True:
        try:
            b = os.read(r, 65536)
            if not b:
                break
            if size < MAX_LOG_CHARS * 4:
                chunks.append(b)
                size += len(b)
            continue
        except BlockingIOError:
            pass
        now = time.monotonic()
        if status is None:
            done, st = os.waitpid(pid, os.WNOHANG)
            if done:
                status, drain_until = st, now + 1
        if drain_until is not None and now > drain_until:
            break  # a background process still holds the pipe; it is killed below
        if status is None and now > deadline:
            timed_out = True
            break
        time.sleep(0.05)
    os.close(r)
    kill_task_processes()
    if status is None:
        _, status = os.waitpid(pid, 0)
    log = b"".join(chunks).decode("utf-8", "replace")
    if timed_out:
        log += "\nphase timed out after %ds\n" % seconds
    return log, os.waitstatus_to_exitcode(status), timed_out


def kill_task_processes():
    """Stops everything running as nobody, including processes that left the session (setsid, double fork)."""
    pid = os.fork()
    if pid == 0:
        try:
            os.setgroups([])
            os.setgid(NOBODY)
            os.setuid(NOBODY)
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            os.kill(-1, signal.SIGKILL)
        except OSError:
            pass
        os._exit(0)
    os.waitpid(pid, 0)


def reset_between_phases():
    """Nothing the solution leaves behind may decide the score: no reward file, no home files, no processes."""
    for p in (REWARD, os.path.splitext(REWARD)[0] + ".json"):
        if os.path.isdir(p) and not os.path.islink(p):
            shutil.rmtree(p)
        elif os.path.lexists(p):
            os.unlink(p)
    shutil.rmtree(HOME, ignore_errors=True)
    os.makedirs(HOME, mode=0o700)
    os.chown(HOME, NOBODY, NOBODY)


# -P keeps the task directory off sys.path, -s ignores user site-packages; --noconftest and -c ignore conftest.py and
# ini files in the bundle. Neither the solution nor bundle contents can replace the verifiers or pytest itself.
VERIFY = "python3 -P -s -m pytest -q -p no:cacheprovider --noconftest -c %s --rootdir %s eval/test_verifiers.py" % (PYTEST_INI, TASK)


def run_grader(mode, require_netns):
    started = time.monotonic()
    logs = []
    if mode == "oracle":
        log, code, timed_out = phase('bash solution/solve.sh || echo "solve.sh exited with $?"', require_netns, GRADE_SECONDS)
        logs.append(log)
        if code == 97 or timed_out:
            return "".join(logs), code, timed_out
    reset_between_phases()
    left = max(10, GRADE_SECONDS - int(time.monotonic() - started))
    log, code, timed_out = phase(VERIFY, require_netns, left)
    logs.append(log)
    return "".join(logs), code, timed_out


def read_regular(path, limit):
    """Opens without following symlinks, so a task cannot point an output at a file only root can read."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None
        return os.read(fd, limit * 4).decode("utf-8")[:limit]
    finally:
        os.close(fd)


def collect_outputs(root):
    out, left = {}, MAX_OUTPUT_CHARS
    base = os.path.join(root, "workspace/outputs")
    for d, dirs, names in os.walk(base, followlinks=False):
        dirs[:] = sorted(x for x in dirs if not os.path.islink(os.path.join(d, x)))
        for n in sorted(names):
            if left <= 0:
                return out
            try:
                text = read_regular(os.path.join(d, n), left)
            except (OSError, UnicodeDecodeError):
                continue
            if text is None:
                continue
            out[os.path.relpath(os.path.join(d, n), base)] = text
            left -= len(text)
    return out


def read_score(root):
    try:
        text = read_regular(REWARD, 64)
        reward = float((text or "").strip())
    except (OSError, ValueError, UnicodeDecodeError):
        return 0.0, "no reward was written: score 0.00"
    if reward != reward or reward < 0 or reward > 1:
        return 0.0, "reward %r is outside 0..1 (a guardrail was triggered or the verifiers misbehaved): score 0.00" % reward
    return round(reward, 2), "reward %.2f" % reward


def put_json(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="PUT", headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        if r.status >= 300:
            raise GradeError("result upload failed (%d)" % r.status)


def main(argv):
    if len(argv) != 4 or argv[2] not in ("null-agent", "oracle"):
        print("usage: grade.py <bundle-ref> <null-agent|oracle> <result-key>", file=sys.stderr)
        return 2
    bundle_ref, mode, result_key = argv[1], argv[2], argv[3]
    bundle_url, result_url = os.environ.pop("PRAXIS_BUNDLE_URL", ""), os.environ.pop("PRAXIS_RESULT_URL", "")
    if not bundle_url or not result_url:
        print("PRAXIS_BUNDLE_URL and PRAXIS_RESULT_URL are required", file=sys.stderr)
        return 2
    require_netns = os.environ.get("HARBOR_REQUIRE_NETNS", "1") != "0"
    print("grading %s (%s) -> %s" % (bundle_ref, mode, result_key))
    try:
        unpack(fetch(bundle_url), TASK)
        log, code, timed_out = run_grader(mode, require_netns)
        if code == 97:
            raise GradeError(log.strip().splitlines()[-1] if log.strip() else "grader setup failed")
        score, why = (0.0, "timed out: score 0.00") if timed_out else read_score(TASK)
        result = {"score": score, "log": (log + "\n" + why)[-MAX_LOG_CHARS:], "outputs": collect_outputs(TASK)}
    except GradeError as e:
        print("grading failed: %s" % e, file=sys.stderr)
        return 1
    put_json(result_url, result)
    print("score %.2f (%s)" % (score, why))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
