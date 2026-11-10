import { Prisma } from '@prisma/client';
import { EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION, EXTRACTION_SCHEMA_VERSION, type CandidateRule } from '@praxis/shared';
import type { ObjectStorage } from '../../candidate/storage';
import type { PolicyConfig } from '../../config';
import type { Db, Tx } from '../../db';
import { sha256, stableStringify } from '../../lib/crypto';
import { AppError, notFound } from '../../lib/errors';
import type { AuditInput } from '../../platform/audit';
import type { OutboxInput } from '../../outbox/outbox';
import type { EventHandler } from '../../outbox/handlers';
import { loadVersionText } from '../documents';
import { resolveProfile } from '../profiles';
import { createRuleFromCandidate } from '../rules';
import { GoogleLayoutGeminiAdapter } from './google';
import { LlamaExtractAdapter } from './llamaextract';
import { ProviderError, type ExtractionAdapter, type ExtractionInput, type ProfileSnapshot, type ProviderId, type ProviderResult } from './types';

export const SCHEMA_HASH = sha256(stableStringify({ v: EXTRACTION_SCHEMA_VERSION, s: EXTRACTION_JSON_SCHEMA }));
export const PROMPT_HASH = sha256(`${EXTRACTION_PROMPT_VERSION}\n${EXTRACTION_PROMPT}`);
export const POLL_DEADLINE_MS = 30 * 60_000;

export type Adapters = Record<ProviderId, ExtractionAdapter>;

export function defaultAdapters(cfg: PolicyConfig): Adapters {
  return { llamaextract: new LlamaExtractAdapter(cfg), google: new GoogleLayoutGeminiAdapter(cfg) };
}

interface Ctx {
  tx: Tx;
  audit(a: AuditInput): Promise<void>;
  emit(e: OutboxInput): Promise<void>;
}

/** Cumulative spend per provider (reservations plus actual-cost adjustments). */
export async function spentUsd(tx: Db | Tx, provider: ProviderId): Promise<number> {
  const r = await tx.extractionSpend.aggregate({ where: { provider }, _sum: { amountUsd: true } });
  return Number(r._sum.amountUsd ?? 0);
}

/**
 * Starts (or returns) an extraction batch: one job per immutable document version (S1 E08, S2 §7). The same request
 * returns the same batch; a deliberate rerun passes parentBatchId and becomes a child attempt. Budget is reserved
 * before anything is sent, and a job that would exceed the provider ceiling is refused (owner D-B1).
 */
export async function startBatch(
  ctx: Ctx,
  deps: { adapters: Adapters; policy: PolicyConfig },
  input: { clientId: string; projectId: string; actorId: string; documentVersionIds: string[]; override: string | null; parentBatchId?: string | null },
) {
  const { tx } = ctx;
  const ids = [...new Set(input.documentVersionIds)];
  if (!ids.length) throw new AppError(400, 'NO_DOCUMENTS', 'Select at least one document version.');
  const versions = await tx.policyDocumentVersion.findMany({ where: { id: { in: ids }, projectId: input.projectId, clientId: input.clientId } });
  if (versions.length !== ids.length) throw notFound('Document version not found');

  const { snapshot, source } = await resolveProfile(tx, input.clientId, input.projectId, input.override);
  const adapter = deps.adapters[snapshot.provider];
  const problems = adapter.availability();
  if (problems.length) throw new AppError(409, 'PROVIDER_UNAVAILABLE', `Not available: ${problems.join(' ')}`);

  let attemptToken = 'first';
  if (input.parentBatchId) {
    const parent = await tx.extractionBatch.findFirst({ where: { id: input.parentBatchId, projectId: input.projectId, clientId: input.clientId } });
    if (!parent) throw notFound('Extraction batch not found');
    const children = await tx.extractionBatch.count({ where: { parentBatchId: parent.id } });
    attemptToken = `retry:${parent.id}:${children + 1}`;
  }
  const key = sha256(stableStringify({ c: input.clientId, p: input.projectId, docs: versions.map((v) => v.sha256 + ':' + v.id).sort(), profile: `${snapshot.id}@${snapshot.revision}`, schema: SCHEMA_HASH, prompt: PROMPT_HASH, attempt: attemptToken }));
  const existing = await tx.extractionBatch.findUnique({ where: { idempotencyKey: key }, include: { jobs: true } });
  if (existing) return { batch: existing, created: false };

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'policy-budget:' + snapshot.provider}))`;
  const price = deps.policy.prices[snapshot.provider];
  const ceiling = deps.policy.budgets[snapshot.provider];
  const estimates = versions.map((v) => Math.round(v.pageCount * price * 10000) / 10000);
  const total = estimates.reduce((a, b) => a + b, 0);
  if (ceiling === null) throw new AppError(409, 'BUDGET_NOT_SET', 'No spending limit is configured for this provider, so live extraction is refused.');
  const spent = await spentUsd(tx, snapshot.provider);
  if (spent + total > ceiling) {
    throw new AppError(409, 'BUDGET_EXHAUSTED', `This extraction could cost up to $${total.toFixed(2)}, which would take ${snapshot.provider} spend past its $${ceiling.toFixed(2)} limit ($${spent.toFixed(2)} used). Use Paste text, or ask the owner to raise the limit.`);
  }

  const batch = await tx.extractionBatch.create({
    data: {
      clientId: input.clientId,
      projectId: input.projectId,
      idempotencyKey: key,
      profileId: snapshot.id,
      profileRevision: snapshot.revision,
      profileSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      selectionSource: source,
      schemaHash: SCHEMA_HASH,
      promptHash: PROMPT_HASH,
      parentBatchId: input.parentBatchId ?? null,
      requestedById: input.actorId,
    },
  });
  for (const [i, v] of versions.entries()) {
    const job = await tx.extractionJob.create({ data: { clientId: input.clientId, batchId: batch.id, documentVersionId: v.id, provider: snapshot.provider, estimatedUsd: new Prisma.Decimal(estimates[i]!) } });
    await tx.extractionSpend.create({ data: { clientId: input.clientId, provider: snapshot.provider, jobId: job.id, kind: 'RESERVE', amountUsd: new Prisma.Decimal(estimates[i]!) } });
    await ctx.emit({ name: 'policy.extraction_requested', aggregateType: 'ExtractionJob', aggregateId: job.id, payload: { jobId: job.id } });
  }
  await ctx.audit({ entityType: 'ExtractionBatch', entityId: batch.id, action: 'policy.extraction_started', after: { profile: snapshot.id, revision: snapshot.revision, source, documents: versions.map((v) => v.id), reservedUsd: total, parentBatchId: input.parentBatchId ?? null } });
  return { batch: await tx.extractionBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { jobs: true } }), created: true };
}

const TERMINAL = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'UNCERTAIN']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WorkerDeps {
  db: Db;
  storage: ObjectStorage;
  adapters: Adapters;
  /** Test hook: no real waiting between polls. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Runs one extraction job (outbox `run` handler; idempotent and resumable). The provider operation id is saved before
 * polling, so a crash or retry resumes polling instead of submitting again. A submit that fails ambiguously (timeout
 * after sending) is marked UNCERTAIN and never resubmitted automatically (S2 §7).
 */
export async function processExtractionJob(w: WorkerDeps, jobId: string) {
  const { db } = w;
  const wait = w.sleep ?? sleep;
  const now = w.now ?? Date.now;
  const job = await db.extractionJob.findUnique({ where: { id: jobId }, include: { batch: true, documentVersion: true } });
  if (!job || TERMINAL.has(job.status)) return;
  const profile = job.batch.profileSnapshot as unknown as ProfileSnapshot;
  const adapter = w.adapters[profile.provider];
  const v = job.documentVersion;
  const { text, pages } = await loadVersionText(w.storage, v);
  const input: ExtractionInput = { bytes: await w.storage.get(v.storageKey), fileName: v.fileName, format: v.format as ExtractionInput['format'], mediaType: v.mediaType, text, pages, pageCount: v.pageCount };

  let operationId = job.providerOperationId;
  let startedAt = job.startedAt?.getTime() ?? now();
  if (!operationId) {
    const problems = adapter.availability();
    if (problems.length) return finish(w, job.id, { status: 'FAILED', error: `Not available: ${problems.join(' ')}` });
    await db.extractionJob.update({ where: { id: job.id }, data: { status: 'PROCESSING', startedAt: new Date(startedAt), attempt: { increment: job.startedAt ? 1 : 0 } } });
    let submitted: Awaited<ReturnType<ExtractionAdapter['submit']>>;
    try {
      submitted = await adapter.submit(input, profile);
    } catch (e) {
      if (e instanceof ProviderError && e.ambiguous) return finish(w, job.id, { status: 'UNCERTAIN', error: `${e.message} The provider may have accepted the job; it was not resubmitted. Retry as a new attempt if needed.` });
      if (e instanceof ProviderError && e.retryable) throw e;
      return finish(w, job.id, { status: 'FAILED', error: e instanceof ProviderError ? e.message : 'Extraction failed unexpectedly.' });
    }
    operationId = submitted.operationId;
    await db.extractionJob.update({ where: { id: job.id }, data: { providerOperationId: operationId } });
    if (submitted.result) return persistResult(w, job.id, input, submitted.result, operationId, profile);
  }

  let delay = 2000;
  let transportErrors = 0;
  for (;;) {
    if (now() - startedAt > POLL_DEADLINE_MS) {
      await adapter.cleanup(operationId, profile).catch(() => 'failed');
      return finish(w, job.id, { status: 'FAILED', error: 'The provider did not finish within 30 minutes.' });
    }
    let st;
    try {
      st = await adapter.getStatus(operationId, profile);
      transportErrors = 0;
    } catch (e) {
      if (e instanceof ProviderError && e.retryable && ++transportErrors <= 3) {
        await wait(e.retryAfterMs ?? delay);
        continue;
      }
      throw e;
    }
    if (st.status === 'succeeded') {
      const result = await adapter.getResult(operationId, input, profile);
      return persistResult(w, job.id, input, result, operationId, profile);
    }
    if (st.status === 'failed' || st.status === 'cancelled') {
      const cleanup = await adapter.cleanup(operationId, profile).catch(() => 'failed' as const);
      return finish(w, job.id, { status: st.status === 'failed' ? 'FAILED' : 'CANCELLED', error: st.error ?? `The provider reported ${st.status}.`, cleanup });
    }
    await wait(delay);
    delay = Math.min(30_000, Math.round(delay * 1.6));
  }
}

async function persistResult(w: WorkerDeps, jobId: string, input: ExtractionInput, result: ProviderResult, operationId: string, profile: ProfileSnapshot) {
  const job = await w.db.extractionJob.findUniqueOrThrow({ where: { id: jobId }, include: { documentVersion: true } });
  const receiptKey = `policy/${job.clientId}/${job.documentVersion.projectId}/receipts/${job.id}.json`;
  await w.storage.put(receiptKey, Buffer.from(JSON.stringify({ provider: profile.provider, profile: profile.id, revision: profile.revision, operationId, raw: result.raw })), 'application/json');
  const done = await w.db.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text FROM "ExtractionJob" WHERE id = ${jobId}::uuid FOR UPDATE`;
      if (!locked[0] || TERMINAL.has(locked[0].status)) return false;
      let n = 0;
      for (const c of result.candidates) {
        await createRuleFromCandidate(tx, { clientId: job.clientId, projectId: job.documentVersion.projectId, documentVersion: job.documentVersion, doc: input, candidate: c as CandidateRule, origin: `extraction:${profile.provider}`, editedById: `extraction:${job.id}`, extractionJobId: job.id });
        n++;
      }
      const actual = result.usage.actualUsd;
      if (actual !== null) await tx.extractionSpend.create({ data: { clientId: job.clientId, provider: profile.provider, jobId: job.id, kind: 'ADJUST', amountUsd: new Prisma.Decimal(Math.round((actual - Number(job.estimatedUsd)) * 10000) / 10000) } });
      await tx.extractionJob.update({
        where: { id: job.id },
        data: { status: result.partial ? 'PARTIAL' : 'SUCCEEDED', candidateCount: n, rawReceiptKey: receiptKey, usage: result.usage as unknown as Prisma.InputJsonValue, actualUsd: actual === null ? null : new Prisma.Decimal(actual), finishedAt: new Date(), error: result.partial ? 'Some provider output could not be read; usable rules were kept.' : null },
      });
      await tx.auditEvent.create({ data: { clientId: job.clientId, actorType: 'SYSTEM', actorId: 'policy-extraction', entityType: 'ExtractionJob', entityId: job.id, action: 'policy.extraction_completed', after: { candidates: n, partial: result.partial, actualUsd: actual } } });
      return true;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  const cleanup = await w.adapters[profile.provider].cleanup(operationId, profile).catch(() => 'failed' as const);
  await w.db.extractionJob.update({ where: { id: jobId }, data: { cleanup } });
  if (done) await refreshBatch(w.db, job.batchId);
}

async function finish(w: WorkerDeps, jobId: string, r: { status: 'FAILED' | 'CANCELLED' | 'UNCERTAIN'; error: string; cleanup?: string }) {
  const job = await w.db.extractionJob.update({ where: { id: jobId }, data: { status: r.status, error: r.error.slice(0, 1000), finishedAt: new Date(), cleanup: r.cleanup ?? null } });
  await w.db.auditEvent.create({ data: { clientId: job.clientId, actorType: 'SYSTEM', actorId: 'policy-extraction', entityType: 'ExtractionJob', entityId: job.id, action: 'policy.extraction_failed', after: { status: r.status, error: r.error.slice(0, 300) } } });
  await refreshBatch(w.db, job.batchId);
}

export async function refreshBatch(db: Db | Tx, batchId: string) {
  const jobs = await db.extractionJob.findMany({ where: { batchId }, select: { status: true } });
  const s = jobs.map((j) => j.status);
  if (!s.every((x) => TERMINAL.has(x))) {
    if (s.some((x) => x !== 'QUEUED')) await db.extractionBatch.update({ where: { id: batchId }, data: { status: 'PROCESSING' } });
    return;
  }
  const ok = s.filter((x) => x === 'SUCCEEDED').length;
  const usable = s.filter((x) => x === 'SUCCEEDED' || x === 'PARTIAL').length;
  const status = ok === s.length ? 'SUCCEEDED' : usable > 0 ? 'PARTIAL' : s.includes('UNCERTAIN') ? 'UNCERTAIN' : s.every((x) => x === 'CANCELLED') ? 'CANCELLED' : 'FAILED';
  await db.extractionBatch.update({ where: { id: batchId }, data: { status, finishedAt: new Date() } });
}

/** Worker handler: one run per extraction job, outside a transaction (slow provider calls). */
export function policyExtractionHandler(w: Omit<WorkerDeps, 'db'>): EventHandler {
  return { name: 'policy.extract', event: 'policy.extraction_requested', run: (e, db) => processExtractionJob({ ...w, db }, (e.payload as { jobId: string }).jobId) };
}
