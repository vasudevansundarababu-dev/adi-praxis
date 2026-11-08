"""End-to-end check of the grading image: serves bundles and receives results over HTTP, as signed URLs do.

    python3 infra/harbor-verify/test/run_e2e.py <image> <dir with *.tar.gz and names.json>

Expects every catalog bundle to score 0.00 for the null agent and 1.00 for the oracle, and the hostile bundle to score
0.00 with no network, no signed URLs, no root files and no judge files visible to task code.
"""

import http.server
import json
import os
import subprocess
import sys
import threading

image, folder = sys.argv[1], sys.argv[2]
results = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = os.path.join(folder, os.path.basename(self.path))
        if not os.path.isfile(path):
            self.send_response(404)
            self.end_headers()
            return
        data = open(path, "rb").read()
        self.send_response(200)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_PUT(self):
        body = self.rfile.read(int(self.headers["content-length"]))
        results[os.path.basename(self.path)] = json.loads(body)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *a):
        pass


server = http.server.ThreadingHTTPServer(("0.0.0.0", 0), Handler)
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
host = os.environ.get("E2E_HOST", "172.17.0.1")
docker = os.environ.get("DOCKER", "docker").split()


def grade(name, mode):
    key = "%s-%s" % (name, mode)
    run = subprocess.run(
        docker + ["run", "--rm", "--cap-add", "SYS_ADMIN", "--security-opt", "seccomp=unconfined", "--security-opt", "apparmor=unconfined",
                  "--memory", "1g", "--cpus", "1",
                  "-e", "PRAXIS_BUNDLE_URL=http://%s:%d/%s.tar.gz" % (host, port, name),
                  "-e", "PRAXIS_RESULT_URL=http://%s:%d/%s" % (host, port, key),
                  "-e", "PROBE_HOST=%s" % host,
                  image, "bundles/verify/test/%s.tar.gz" % name, mode, "results/%s.json" % key],
        capture_output=True, text=True, timeout=300)
    if run.returncode != 0 or key not in results:
        print(run.stdout, run.stderr)
        raise SystemExit("FAIL %s: grade.py exited %d" % (key, run.returncode))
    return results[key]


failed = False
for name in json.load(open(os.path.join(folder, "names.json"))):
    if name == "hostile":
        continue
    zero, oracle = grade(name, "null-agent"), grade(name, "oracle")
    ok = zero["score"] == 0 and oracle["score"] == 1 and "network=netns" in oracle["log"]
    failed |= not ok
    print("%s  %s: null agent %.2f, oracle %.2f" % ("PASS" if ok else "FAIL", name, zero["score"], oracle["score"]))
    if not ok:
        print(zero["log"][-3000:], oracle["log"][-3000:])

h = grade("hostile", "oracle")
probe = json.loads(h["outputs"].get("probe.json", "{}"))
checks = {
    "score is 0.00 (forged reward and conftest.py ignored)": h["score"] == 0,
    "no internet": probe.get("net", "").startswith("blocked"),
    "no route to the host": probe.get("host", "").startswith("blocked"),
    "no signed URLs in the environment": probe.get("env_urls") == [],
    "parent environment unreadable": str(probe.get("parent_env", "")).startswith("unreadable") or probe.get("parent_env") is False,
    "runs as nobody": probe.get("uid") == 65534,
    "cannot write /etc/shadow": probe.get("write:/etc/shadow") == "denied",
    "cannot change the verifiers": probe.get("write:/tmp/task/eval/test_verifiers.py") == "denied",
    "judge files absent": probe.get("judge_present") is False,
    "symlinked output not followed": "leak.txt" not in h["outputs"],
}
for k, v in checks.items():
    failed |= not v
    print("%s  hostile: %s" % ("PASS" if v else "FAIL", k))
if not all(checks.values()):
    print(json.dumps(probe, indent=1), h["log"][-3000:])
server.shutdown()
sys.exit(1 if failed else 0)
