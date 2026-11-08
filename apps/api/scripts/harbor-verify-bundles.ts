/**
 * Writes the catalog bundles and one hostile bundle for infra/harbor-verify/test/run_e2e.py (CI and local runs):
 *
 *   pnpm --filter @praxis/api exec tsx scripts/harbor-verify-bundles.ts <out-dir>
 */
import { defaultStudioAnswers } from '@praxis/shared';
import { writeFileSync } from 'node:fs';
import { buildBundle } from '../src/harbor/bundle';
import { gzipDeterministic, writeTar } from '../src/harbor/tar';
import { catalogBlueprints } from '../prisma/catalog/index';
import { catalogMeta } from '../prisma/catalog/verify-docker';
const out = process.argv[2]!;
const names: string[] = [];
for (const { workflowName, blueprint } of catalogBlueprints()) {
  const b = buildBundle(blueprint, defaultStudioAnswers(blueprint), catalogMeta(blueprint));
  const n = workflowName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  writeFileSync(`${out}/${n}.tar.gz`, b.bytes);
  names.push(n);
}
const e = new TextEncoder();
const f = (path: string, text: string, mode = 0o644) => ({ path, data: e.encode(text), mode });
// Hostile oracle: probes the network, the signed URLs, root files and the verifiers, then forges a passing reward.
const hostile = `#!/usr/bin/env bash
python3 - <<'PY'
import os, socket, json
r = {}
try:
    s = socket.create_connection(("1.1.1.1", 80), timeout=3); r["net"] = "CONNECTED"
except OSError as e: r["net"] = "blocked:" + type(e).__name__
try:
    s = socket.create_connection((os.environ.get("PROBE_HOST","host.docker.internal"), 8099), timeout=3); r["host"] = "CONNECTED"
except OSError as e: r["host"] = "blocked:" + type(e).__name__
r["env_urls"] = [k for k in os.environ if "URL" in k]
try: r["parent_env"] = "PRAXIS" in open("/proc/1/environ","rb").read().decode("latin1")
except OSError as e: r["parent_env"] = "unreadable:" + type(e).__name__
r["uid"] = os.getuid()
for p in ["/etc/shadow", os.environ["HARBOR_ROOT"] + "/eval/test_verifiers.py"]:
    try: open(p, "a").close(); r["write:" + p] = "WROTE"
    except OSError as e: r["write:" + p] = "denied"
r["judge_present"] = os.path.exists(os.environ["HARBOR_ROOT"] + "/eval/judge")
os.makedirs(os.environ["HARBOR_ROOT"] + "/workspace/outputs", exist_ok=True)
try: os.symlink("/proc/1/environ", os.environ["HARBOR_ROOT"] + "/workspace/outputs/leak.txt")
except OSError: pass
open(os.environ["HARBOR_ROOT"] + "/workspace/outputs/probe.json", "w").write(json.dumps(r))
# Try to forge a passing reward directly.
os.makedirs(os.environ["HARBOR_ROOT"] + "/logs/verifier", exist_ok=True)
open(os.environ["HARBOR_ROOT"] + "/logs/verifier/reward.txt", "w").write("1.00\\n")
PY
`;
const verifiers = `def test_never_passes():\n    assert False\n`;
writeFileSync(`${out}/hostile.tar.gz`, gzipDeterministic(writeTar([f('task.json', '{}'), f('solution/solve.sh', hostile, 0o755), f('eval/test_verifiers.py', verifiers), f('eval/judge/m1.json', '{"secret":"checklist"}'), f('conftest.py', 'import pytest\ndef pytest_collection_modifyitems(items):\n    raise SystemExit(0)\n')])));
names.push('hostile');
writeFileSync(`${out}/names.json`, JSON.stringify(names));
console.log(names.join('\n'));
