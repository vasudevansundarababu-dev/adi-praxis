/**
 * End-to-end check of the LOCAL grading path: the same bundles infra/harbor-verify/test/run_e2e.py grades through the
 * sandbox-job entry (signed URLs), graded here through DockerRunner (grade.py local mode). Both must agree, which is
 * the point of having one grading path.
 *
 *   pnpm --filter @praxis/api exec tsx scripts/harbor-verify-bundles.ts <dir>
 *   pnpm --filter @praxis/api exec tsx scripts/harbor-docker-runner-e2e.ts <dir> [image]
 *
 * Expects: every catalog bundle 0.00 for the null agent and 1.00 for the oracle; the hostile bundle 0.00, run as nobody,
 * with no network, unable to change the verifiers, with no judge files and no followed symlinks.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MemoryStorage } from '../src/candidate/storage';
import { DockerRunner } from '../src/harbor/runner';

const [dir, image = 'praxis-harbor-verify:local'] = process.argv.slice(2);
if (!dir) throw new Error('usage: harbor-docker-runner-e2e.ts <bundle dir> [image]');

const storage = new MemoryStorage();
const runner = new DockerRunner({ storage, image });
let failed = false;
const check = (ok: boolean, what: string, detail = '') => {
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok || !detail ? '' : `\n${detail}`}`);
};

const names = JSON.parse(readFileSync(path.join(dir, 'names.json'), 'utf8')) as string[];
for (const n of names) await storage.put(`${n}.tar.gz`, readFileSync(path.join(dir, `${n}.tar.gz`)), 'application/gzip');

for (const n of names.filter((x) => x !== 'hostile')) {
  const zero = await runner.run(`${n}.tar.gz`, 'null-agent');
  const oracle = await runner.run(`${n}.tar.gz`, 'oracle');
  check(zero.score === 0 && oracle.score === 1 && oracle.log.includes('uid=65534'), `${n}: null agent ${zero.score.toFixed(2)}, oracle ${oracle.score.toFixed(2)}`, `${zero.log.slice(-2000)}\n${oracle.log.slice(-2000)}`);
}

const h = await runner.run('hostile.tar.gz', 'oracle');
const probe = JSON.parse(h.outputs?.['probe.json'] ?? '{}') as Record<string, unknown>;
const root = '/tmp/task';
check(h.score === 0, 'hostile: score 0.00 (forged reward and conftest.py ignored)', h.log.slice(-2000));
check(probe.uid === 65534, 'hostile: task code runs as nobody');
check(String(probe.net ?? '').startsWith('blocked'), 'hostile: no internet');
check(probe.loopback === 'ok', 'hostile: loopback sockets work');
check(probe.env_urls instanceof Array && probe.env_urls.length === 0, 'hostile: no URLs in the task environment');
check(probe[`write:${root}/eval/test_verifiers.py`] === 'denied', 'hostile: cannot change the verifiers');
check(probe['write:/etc/shadow'] === 'denied', 'hostile: cannot write /etc/shadow');
check(probe.judge_present === false, 'hostile: judge files absent');
check(!('leak.txt' in (h.outputs ?? {})), 'hostile: symlinked output not followed');
if (failed) console.log(JSON.stringify(probe, null, 1));
process.exitCode = failed ? 1 : 0;
