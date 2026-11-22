"""Grades one Harbor bundle inside the praxis-harbor-verify Cloud Run job, and locally (DockerRunner).

    grade.py <bundle-ref> <null-agent|oracle> <result-key>

Two ways in, one grading path, so a local score is the production score:
  sandbox job  PRAXIS_BUNDLE_URL + PRAXIS_RESULT_URL (signed GET / PUT). Network isolation of task code is mandatory.
  local        PRAXIS_BUNDLE_FILE (a read-only mounted .tar.gz) and the result printed to stdout after RESULT_MARKER.
               The container itself runs with --network=none, so the in-process network namespace is optional there.

The job's service account has no storage access. The worker passes a short-lived signed GET URL for the bundle and a
signed PUT URL for the result (PRAXIS_BUNDLE_URL, PRAXIS_RESULT_URL). This process (root) downloads and unpacks the
bundle, then forks the grader, which leaves the network namespace, drops to nobody and gets a clean environment, so
task code can reach neither the network nor the signed URLs. The score is the reward the verifiers write
(logs/verifier/reward.txt), as in prisma/catalog/verify-docker.ts.
"""

import fcntl
import io
import json
import os
import resource
import shutil
import signal
import socket
import stat
import struct
import sys
import tarfile
import time
import urllib.request
import zlib

NOBODY = 65534
TASK = "/tmp/task"
HOME = "/tmp/home"
MAX_BUNDLE_BYTES = 50 * 1024 * 1024
# Decompressed size cap: a 50 MB gzip can expand to many GB and exhaust the job's 1 GiB of memory.
MAX_TAR_BYTES = 200 * 1024 * 1024
RESULT_MARKER = "@@PRAXIS_RESULT@@"
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
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = r.read(MAX_BUNDLE_BYTES + 1)
    except OSError as e:  # URLError, HTTPError and timeouts are all OSError
        raise GradeError("cannot download the bundle (%s)" % e)
    if len(data) > MAX_BUNDLE_BYTES:
        raise GradeError("bundle is larger than %d bytes" % MAX_BUNDLE_BYTES)
    return data


def read_file(path):
    try:
        with open(path, "rb") as f:
            data = f.read(MAX_BUNDLE_BYTES + 1)
    except OSError as e:
        raise GradeError("cannot read the bundle file (%s)" % e)
    if len(data) > MAX_BUNDLE_BYTES:
        raise GradeError("bundle is larger than %d bytes" % MAX_BUNDLE_BYTES)
    return data


def gunzip_capped(data):
    """gzip -> tar bytes, refusing anything that expands past MAX_TAR_BYTES (decompression bomb)."""
    d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    try:
        out = d.decompress(data, MAX_TAR_BYTES + 1)
    except zlib.error as e:
        raise GradeError("bundle is not valid gzip (%s)" % e)
    if len(out) > MAX_TAR_BYTES or d.unconsumed_tail:
        raise GradeError("bundle expands past %d bytes" % MAX_TAR_BYTES)
    return out


def safe_member_path(name):
    parts = name.split("/")
    if name.startswith("/") or ".." in parts or "" in parts or "\\" in name:
        raise GradeError("unsafe path in bundle: %r" % name)
    return name


def unpack(data, root):
    """Regular files only; no links, devices or paths outside root. Directories are root-owned and read-only."""
    os.makedirs(root, mode=0o755)
    count = 0
    try:
        tar = tarfile.open(fileobj=io.BytesIO(gunzip_capped(data)), mode="r:")
    except tarfile.TarError as e:
        raise GradeError("bundle is not a valid tar archive (%s)" % e)
    try:
        with tar:
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
                try:
                    f = open(target, "xb")
                except FileExistsError:
                    raise GradeError("bundle lists a file twice: %r" % m.name)
                with f:
                    f.write(tar.extractfile(m).read())
                os.chmod(target, 0o755 if m.mode & 0o111 else 0o644)
    except tarfile.TarError as e:  # truncated or corrupt member headers surface while iterating
        raise GradeError("bundle is not a valid tar archive (%s)" % e)
    for d in WRITABLE_DIRS:
        path = os.path.join(root, d)
        os.makedirs(path, mode=0o755, exist_ok=True)
        os.chown(path, NOBODY, NOBODY)
    os.makedirs(HOME, mode=0o700, exist_ok=True)
    os.chown(HOME, NOBODY, NOBODY)


def leave_network():
    """New empty network namespace (only a down loopback). Needs CAP_SYS_ADMIN; raises if it cannot be done.

    There is deliberately no user-namespace fallback: without uid/gid maps the later setgroups/setuid to nobody fail,
    so it could never work, and a half-isolated grader is worse than a refused one.
    """
    try:
        os.unshare(os.CLONE_NEWNET)
        return "netns"
    except OSError as e:
        raise GradeError("cannot isolate the network (%s)" % e.strerror)


SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1


def loopback_up():
    """Brings `lo` up in the new namespace (it starts down, so 127.0.0.1 could be neither bound nor reached).

    Task code may run an internal loopback server (the MCP mock, a fixture service); loopback never leaves the
    namespace, so isolation is unchanged. Needs CAP_NET_ADMIN in the namespace: call before dropping privileges.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        req = struct.pack("16sH14x", b"lo", 0)
        flags = struct.unpack("16sH14x", fcntl.ioctl(s.fileno(), SIOCGIFFLAGS, req))[1]
        fcntl.ioctl(s.fileno(), SIOCSIFFLAGS, struct.pack("16sH14x", b"lo", flags | IFF_UP))
    finally:
        s.close()


def loopback_works():
    """Check, not assumption: bind an ephemeral port on 127.0.0.1 and connect to it."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        c = socket.create_connection(srv.getsockname(), timeout=2)
        c.close()
    finally:
        srv.close()


def as_nobody(require_netns):
    """In a forked child: own session, empty network namespace with loopback up, nobody with no groups, limits."""
    os.setsid()
    try:
        how = leave_network()
    except GradeError as e:
        if require_netns:
            raise
        how = "none (%s)" % e
    # Best effort, never fatal: bringing lo up needs CAP_NET_ADMIN, which a runtime may not grant (plain Docker does
    # not). Grading must not break where it worked before, so the log line says which case applied; a task that
    # needs 127.0.0.1 then fails with a visible reason instead of a silent EADDRNOTAVAIL.
    # Check first: under docker --network=none loopback is already up (and CAP_NET_ADMIN is not granted).
    try:
        loopback_works()
        how += " loopback=up"
    except OSError:
        try:
            loopback_up()
            loopback_works()
            how += " loopback=up"
        except OSError as e:
            how += " loopback=down (%s)" % e.strerror
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
    # Not ignore_errors: if the solution's home cannot be emptied (e.g. root lacks CAP_DAC_OVERRIDE), its files would
    # survive into the verify phase, so refuse to grade instead.
    try:
        shutil.rmtree(HOME)
    except FileNotFoundError:
        pass
    except OSError as e:
        raise GradeError("cannot reset the task home between phases (%s)" % e)
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
    try:
        reset_between_phases()
    except GradeError as e:
        return "".join(logs) + "grader setup failed: %s\n" % e, 97, False
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
    # Popped, so they never reach a child process environment (task code also gets a clean env, see task_env).
    bundle_url, result_url = os.environ.pop("PRAXIS_BUNDLE_URL", ""), os.environ.pop("PRAXIS_RESULT_URL", "")
    bundle_file = os.environ.pop("PRAXIS_BUNDLE_FILE", "")
    if bundle_url and result_url and not bundle_file:
        local = False
    elif bundle_file and not bundle_url and not result_url:
        local = True
    else:
        print("set PRAXIS_BUNDLE_URL and PRAXIS_RESULT_URL (sandbox job), or only PRAXIS_BUNDLE_FILE (local)", file=sys.stderr)
        return 2
    # The sandbox job always isolates task code in its own network namespace; only a local container (already
    # --network=none) may run without it. The switch cannot weaken the job, whatever execution overrides say.
    require_netns = True if not local else os.environ.get("HARBOR_REQUIRE_NETNS", "1") != "0"
    print("grading %s (%s) -> %s" % (bundle_ref, mode, result_key))
    try:
        unpack(read_file(bundle_file) if local else fetch(bundle_url), TASK)
        log, code, timed_out = run_grader(mode, require_netns)
        if code == 97:
            raise GradeError(log.strip().splitlines()[-1] if log.strip() else "grader setup failed")
        score, why = (0.0, "timed out: score 0.00") if timed_out else read_score(TASK)
        result = {"score": score, "log": (log + "\n" + why)[-MAX_LOG_CHARS:], "outputs": collect_outputs(TASK)}
    except GradeError as e:
        print("grading failed: %s" % e, file=sys.stderr)
        return 1
    if local:
        sys.stdout.write("%s\n%s\n" % (RESULT_MARKER, json.dumps(result)))
    else:
        put_json(result_url, result)
    print("score %.2f (%s)" % (score, why))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
