import type { CompilerVerificationRun, Prisma } from '@prisma/client';
import { VERIFICATION_CHECK_IDS, type BundleManifestEntry, type HarborBlueprint, type RunnerResult, type VerificationRunDto } from '@praxis/shared';
import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import type { HarborRunner } from '../harbor/runner';
import { defaultAnswers, type MetaCompilerDeps } from './deps';
import { loadGenerationOutput } from './generation';
import { redact, tail } from './redact';

export type CheckId = (typeof VERIFICATION_CHECK_IDS)[number];
export interface Check {
  id: CheckId;
  passed: boolean | null;
  value: string | null;
  evidence: string | null;
}

export const pendingChecks = (): Check[] => VERIFICATION_CHECK_IDS.map((id) => ({ id, passed: null, value: null, evidence: null }));

export function verificationDto(r: CompilerVerificationRun, logTail: string): VerificationRunDto {
  return {
    id: r.id,
    generationRunId: r.generationRunId,
    status: r.status,
    checks: r.checks as unknown as Check[],
    zeroBaselineScore: r.zeroBaselineScore === null ? null : Number(r.zeroBaselineScore),
    oracleScore: r.oracleScore === null ? null : Number(r.oracleScore),
    bundleSha256: r.bundleSha256,
    logTail,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

export async function verificationLogTail(storage: ObjectStorage, logRef: string | null) {
  if (!logRef) return '';
  return tail((await storage.get(logRef).catch(() => Buffer.from(''))).toString('utf8'));
}

/** Files the PRD §6.3 layout requires in every bundle. */
export function requiredPaths(bp: HarborBlueprint): string[] {
  return ['task.json', 'instruction.md', 'environment/mcp_mock.py', 'eval/test_verifiers.py', 'solution/solve.sh', ...bp.step_2_data_panels.public_dropzones.map((d) => d.target_path.replace(/^\//, ''))];
}

export const isHiddenPath = (p: string) => p.startsWith('eval/') || p.startsWith('solution/');

/** Checks 01 and 02: layout and hidden paths (D-20, D-21), from the bundle manifest. */
export function layoutChecks(bp: HarborBlueprint, manifest: BundleManifestEntry[]): Check[] {
  const paths = manifest.map((m) => m.path);
  const missing = requiredPaths(bp).filter((p) => !paths.includes(p));
  const leaks = manifest.filter((m) => isHiddenPath(m.path) !== m.hidden).map((m) => m.path);
  const gt = bp.step_2_data_panels.oracle_annotator.target_path.replace(/^\//, '');
  const gtHidden = !gt || manifest.some((m) => m.path === gt && m.hidden);
  const agentView = manifest.filter((m) => !m.hidden).map((m) => m.path);
  return [
    { id: '01_bundle_layout', passed: missing.length === 0, value: `${paths.length} files`, evidence: missing.length ? `missing: ${missing.join(', ')}` : paths.join(', ') },
    {
      id: '02_hidden_paths',
      passed: leaks.length === 0 && gtHidden,
      value: `${manifest.length - agentView.length} hidden`,
      evidence: leaks.length || !gtHidden ? `exposed to the agent: ${[...leaks, ...(gtHidden ? [] : [gt])].join(', ')}` : `agent sees: ${agentView.join(', ')}`,
    },
  ];
}

export function networkCheck(bp: HarborBlueprint, runner: HarborRunner): Check {
  const how = runner.kind === 'job' ? 'Cloud Run job without egress' : runner.kind === 'docker' ? 'docker --network=none' : 'mock runner (no execution)';
  return { id: '03_network_internal', passed: bp.harbor_contract.network_internal === true, value: bp.harbor_contract.network_internal ? 'internal' : 'external', evidence: `harbor_contract.network_internal=${bp.harbor_contract.network_internal}; ${how}` };
}

export const gateChecks = (zero: RunnerResult, oracle: RunnerResult): Check[] => [
  { id: '04_zero_baseline', passed: zero.score === 0, value: zero.score.toFixed(2), evidence: `runner ${zero.runnerRef}` },
  { id: '05_oracle_solve', passed: oracle.score === 1, value: oracle.score.toFixed(2), evidence: `runner ${oracle.runnerRef}` },
];

export interface VerificationWorkerDeps {
  db: Db;
  storage: ObjectStorage;
  config: Config;
  runner: HarborRunner;
  deps: MetaCompilerDeps;
}

/**
 * Step 2 in the worker (S3-04, S3-05, D-12): inject the synthetic payload, build the test bundle, store it under
 * `bundles/verify/`, run checks 01 to 05 and keep the measured scores with evidence and a redacted log.
 */
export async function processVerification(w: VerificationWorkerDeps, id: string): Promise<void> {
  const { db, storage, runner } = w;
  const claimed = await db.compilerVerificationRun.updateMany({ where: { id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'RUNNING', startedAt: new Date() } });
  if (!claimed.count) return;
  const run = await db.compilerVerificationRun.findUniqueOrThrow({ where: { id }, include: { generationRun: true } });
  const log: string[] = [`verification ${id} for generation ${run.generationRunId} with the ${runner.kind} runner`];
  const logRef = `verifications/${run.clientId}/${id}/log.txt`;
  const finish = async (data: Prisma.CompilerVerificationRunUpdateInput) => {
    await storage.put(logRef, Buffer.from(redact(log.join('\n'))), 'text/plain');
    await db.compilerVerificationRun.update({ where: { id }, data: { ...data, logRef, finishedAt: new Date() } });
  };
  const checks = pendingChecks();
  const setCheck = (c: Check) => (checks[checks.findIndex((x) => x.id === c.id)] = c);
  try {
    const output = await loadGenerationOutput(storage, run.generationRun);
    const bp = output.blueprint;
    const g = run.generationRun;
    const bundle = w.deps.buildBundle(bp, defaultAnswers(bp), {
      externalTaskId: `VERIFY-${id.slice(0, 8).toUpperCase()}`,
      title: bp.domain_meta.title,
      templateId: g.templateId,
      templateVersion: g.templateVersion,
      executionMode: bp.template_meta.modes[0] ?? 'HERMETIC_MCP',
      dataClassification: 'SYNTHETIC',
    });
    const bundleRef = `bundles/verify/${run.clientId}/${bundle.sha256}.tar.gz`;
    await storage.put(bundleRef, Buffer.from(bundle.bytes), 'application/gzip');
    log.push(`bundle ${bundleRef} (${bundle.bytes.length} bytes, ${bundle.manifest.length} files)`);
    for (const c of [...layoutChecks(bp, bundle.manifest), networkCheck(bp, runner)]) setCheck(c);
    await db.compilerVerificationRun.update({ where: { id }, data: { checks: checks as unknown as Prisma.InputJsonValue, bundleRef, bundleSha256: bundle.sha256 } });
    const zero = await runner.run(bundleRef, 'null-agent');
    log.push(`--- null agent: ${zero.score.toFixed(2)} (${zero.runnerRef})`, zero.log);
    const oracle = await runner.run(bundleRef, 'oracle');
    log.push(`--- oracle: ${oracle.score.toFixed(2)} (${oracle.runnerRef})`, oracle.log);
    for (const c of gateChecks(zero, oracle)) setCheck(c);
    const failed = checks.filter((c) => !c.passed).map((c) => c.id);
    await finish({
      status: failed.length ? 'FAILED' : 'SUCCEEDED',
      checks: checks as unknown as Prisma.InputJsonValue,
      zeroBaselineScore: zero.score,
      oracleScore: oracle.score,
      runnerRef: `${zero.runnerRef} ${oracle.runnerRef}`,
      error: failed.length ? `Checks failed: ${failed.join(', ')}` : null,
    });
  } catch (err) {
    log.push(`error: ${err instanceof Error ? err.message : String(err)}`);
    await finish({ status: 'FAILED', checks: checks as unknown as Prisma.InputJsonValue, error: redact(err instanceof Error ? err.message : 'Verification failed') });
  }
}
