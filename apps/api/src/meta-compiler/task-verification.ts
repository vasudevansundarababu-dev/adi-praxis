import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import type { HarborRunner } from '../harbor/runner';
import { writeAudit } from '../platform/audit';
import { redact } from './redact';

export interface TaskVerificationDeps {
  db: Db;
  storage: ObjectStorage;
  config: Config;
  runner: HarborRunner;
}

/** Stored in `SmeAuthoredTask.verificationEvidence`: what was measured, by which runner, when, and where the log is. */
export interface TaskVerificationEvidence {
  status: 'MEASURED' | 'NOT_MEASURED';
  passed: boolean | null;
  runner: HarborRunner['kind'];
  runnerRefs: string[];
  verifyBundleRef: string | null;
  logRef: string;
  verifiedAt: string;
  error: string | null;
}

export const taskVerificationLogKey = (clientId: string, id: string) => `studio-tasks/${clientId}/${id}/verification-log.txt`;

/**
 * Per-task verification after Save & Commit (architecture section 7, D-12): the worker grades the committed bundle with
 * the null agent and the oracle and records the measured scores with evidence on `SmeAuthoredTask`. Review is not
 * gated on it; the scores are evidence for the Reviewer and downstream consumers. Idempotent: a task that already has
 * both scores is left alone. A runner failure is recorded and rethrown, so the outbox retries it.
 */
export async function processAuthoredTaskVerification(w: TaskVerificationDeps, authoredTaskId: string): Promise<void> {
  const { db, storage, runner } = w;
  const t = await db.smeAuthoredTask.findUnique({ where: { id: authoredTaskId } });
  if (!t || (t.zeroBaselineScore !== null && t.oracleScore !== null)) return;
  const logRef = taskVerificationLogKey(t.clientId, t.id);
  const log: string[] = [`task ${t.externalTaskId} (${t.id}) bundle ${t.bundleRef} with the ${runner.kind} runner`];
  const record = async (scores: { zero: number; oracle: number } | null, evidence: TaskVerificationEvidence) => {
    await storage.put(logRef, Buffer.from(redact(log.join('\n'))), 'text/plain');
    await db.$transaction(async (tx) => {
      await tx.smeAuthoredTask.update({
        where: { id: t.id },
        data: { verificationEvidence: evidence as unknown as Prisma.InputJsonValue, ...(scores ? { zeroBaselineScore: scores.zero, oracleScore: scores.oracle } : {}) },
      });
      await writeAudit(tx, { clientId: t.clientId, actorType: 'SYSTEM', actorId: null }, {
        entityType: 'SmeAuthoredTask',
        entityId: t.id,
        action: scores ? 'studio.task_verified' : 'studio.task_verification_failed',
        after: { zeroBaselineScore: scores?.zero ?? null, oracleScore: scores?.oracle ?? null, passed: evidence.passed, runner: evidence.runner, runnerRefs: evidence.runnerRefs, error: evidence.error },
      });
    });
  };
  const base = { runner: runner.kind, logRef, verifiedAt: new Date().toISOString() };

  // D-12: deployed environments never record mock scores as measured results.
  if (runner.kind === 'mock' && (w.config.appEnv === 'staging' || w.config.appEnv === 'production')) {
    log.push('not measured: the mock runner cannot produce real scores in this environment');
    return record(null, { ...base, status: 'NOT_MEASURED', passed: null, runnerRefs: [], verifyBundleRef: null, error: 'The sandbox runner is not configured (HARBOR_RUNNER=job).' });
  }

  let verifyBundleRef: string | null = null;
  const runnerRefs: string[] = [];
  try {
    const bytes = await storage.get(t.bundleRef);
    if (createHash('sha256').update(bytes).digest('hex') !== t.bundleSha256) throw new Error('The stored bundle does not match its SHA-256');
    // The sandbox job can only read `bundles/verify/*`: grade a content-addressed copy there.
    verifyBundleRef = `bundles/verify/${t.clientId}/${t.bundleSha256}.tar.gz`;
    await storage.put(verifyBundleRef, bytes, 'application/gzip');
    const zero = await runner.run(verifyBundleRef, 'null-agent');
    runnerRefs.push(zero.runnerRef);
    log.push(`--- null agent: ${zero.score.toFixed(2)} (${zero.runnerRef})`, zero.log);
    const oracle = await runner.run(verifyBundleRef, 'oracle');
    runnerRefs.push(oracle.runnerRef);
    log.push(`--- oracle: ${oracle.score.toFixed(2)} (${oracle.runnerRef})`, oracle.log);
    const passed = zero.score === 0 && oracle.score === 1;
    await record({ zero: zero.score, oracle: oracle.score }, { ...base, status: 'MEASURED', passed, runnerRefs, verifyBundleRef, error: passed ? null : 'Zero-baseline must be 0.00 and oracle 1.00' });
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : 'Verification failed');
    log.push(`error: ${message}`);
    await record(null, { ...base, status: 'NOT_MEASURED', passed: null, runnerRefs, verifyBundleRef, error: message });
    throw err;
  }
}
