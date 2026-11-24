import type { OutcomeBatch, OutcomeBatchItem, Prisma, Template } from '@prisma/client';
import { OUTCOME_REQUEST_SCHEMA, type EdgeFamily, type OutcomeField } from '@praxis/shared';
import { z } from 'zod';
import { jcsSha256 } from '../anvil/jcs';
import type { FamilyCatalog } from '../anvil/edge-family-catalog';
import type { StudioResult } from '../anvil/studio-client';
import type { Db, Tx } from '../db';
import { AppError, forbidden, notFound } from '../lib/errors';

/**
 * E-001 §6b (owner, 24 Nov 2026): SMEs own edge cases and write the expected outcome of every variant. To protect SME
 * time (about $1000 a day) the PM sends the variants waiting for an outcome in one batch, to one SME, or answers them as
 * Admin acting for an SME (the owner confirms the four migrated outcomes this way). A second check by another person is
 * optional per batch (owner: off by default). When every item is answered (and checked, if asked), the batch is written
 * to Studio as outcome-request.v1, whole or not at all. Studio never sets or edits an outcome.
 */

type Audit = (a: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown }) => Promise<void>;
export type Who = { kind: 'admin'; userId: string } | { kind: 'sme'; smeUserId: string };
const whoId = (w: Who) => (w.kind === 'admin' ? w.userId : w.smeUserId);
/** Pseudonyms only (never a name): sme-<8 hex> or, for the owner acting as Admin for an SME, admin-<8 hex>. */
export const pseudonym = (kind: string, id: string) => `${kind === 'admin' ? 'admin' : 'sme'}-${id.replace(/-/g, '').slice(0, 8)}`;

export const OutcomeAnswer = z.discriminatedUnion('verdict', [
  z
    .object({
      verdict: z.literal('confirm'),
      decision: z.string().trim().min(1).max(100),
      fields: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.string().max(500)).default({}),
      rationale: z.string().trim().min(10, 'Say why this is the right outcome.').max(4000),
      evidence: z.array(z.string().trim().min(2).max(500)).min(1, 'Name at least one piece of evidence the analyst should cite.').max(20),
    })
    .strict(),
  z.object({ verdict: z.literal('reject'), rationale: z.string().trim().min(10, 'Say why this variant is wrong or does not count.').max(4000) }).strict(),
  z.object({ verdict: z.literal('cannot_decide'), rationale: z.string().trim().min(10, 'Say what you would need to decide.').max(4000) }).strict(),
]);
export type OutcomeAnswer = z.infer<typeof OutcomeAnswer>;

export const NewOutcomeBatch = z
  .object({
    variantIds: z.array(z.string().min(1).max(100)).min(1).max(100),
    answerer: z.enum(['admin', 'sme']),
    smeUserId: z.string().uuid().optional(),
    secondCheck: z.boolean().default(false),
    note: z.string().trim().max(2000).optional(),
    dueBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();
export type NewOutcomeBatch = z.infer<typeof NewOutcomeBatch>;

/** Variants still waiting for a person's outcome: no outcome yet, or one carried over by a migration. */
export const waitingVariants = (families: EdgeFamily[]) => families.flatMap((f) => f.variants.filter((v) => v.needsConfirmation && v.state !== 'retired').map((v) => ({ family: f, variant: v })));

/** The answer checked against the catalog's outcome fields (the decision is the required field's value). */
export function answerProblems(a: OutcomeAnswer, fields: OutcomeField[]): string[] {
  if (a.verdict !== 'confirm') return [];
  const out: string[] = [];
  const decisionField = fields.find((f) => f.required) ?? null;
  if (decisionField?.allowedValues && !decisionField.allowedValues.includes(a.decision)) out.push(`${decisionField.label} must be one of ${decisionField.allowedValues.join(', ')}.`);
  for (const [k, v] of Object.entries(a.fields)) {
    const f = fields.find((x) => x.name === k);
    if (fields.length && !f) out.push(`"${k}" is not an outcome field of this environment.`);
    else if (f?.allowedValues && v && !f.allowedValues.includes(v)) out.push(`${f.label} must be one of ${f.allowedValues.join(', ')}.`);
  }
  return out;
}

export async function createBatch(tx: Tx, p: { id: string; clientId: string; template: Template }, cat: FamilyCatalog, actorUserId: string, body: NewOutcomeBatch, audit: Audit) {
  if (cat.source !== 'catalog' || !cat.studioTemplate) throw new AppError(409, 'NO_CATALOG', cat.fallbackReason ?? 'Studio’s edge-case catalog is not available for this template version.');
  const waiting = waitingVariants(cat.families);
  const picked = body.variantIds.map((id) => waiting.find((w) => w.variant.variantId === id) ?? null);
  const unknown = body.variantIds.filter((_, i) => !picked[i]);
  if (unknown.length) throw new AppError(422, 'NOT_WAITING', `These variants are not waiting for an outcome: ${unknown.join(', ')}.`);
  if (body.answerer === 'sme') {
    if (!body.smeUserId) throw new AppError(422, 'SME_REQUIRED', 'Choose the SME who answers this batch.');
    const onProject = await tx.taskInstance.count({ where: { projectId: p.id, OR: [{ assignedTo: { smeUserId: body.smeUserId } }, { reviewerSmeUserId: body.smeUserId }] } });
    if (!onProject) throw new AppError(422, 'NOT_ON_PROJECT', 'Only an SME working on this project (an author or an SME Reviewer) can answer its batch.');
  }
  const open = await tx.outcomeBatchItem.findMany({ where: { variantId: { in: body.variantIds }, batch: { projectId: p.id, state: { in: ['open', 'awaiting_check'] } } }, select: { variantId: true } });
  if (open.length) throw new AppError(409, 'ALREADY_IN_A_BATCH', `Already in an open batch: ${[...new Set(open.map((o) => o.variantId))].join(', ')}.`);
  const requestId = `orq-${jcsSha256({ p: p.id, v: [...body.variantIds].sort(), at: Date.now(), by: actorUserId }).slice(0, 16)}`;
  const batch = await tx.outcomeBatch.create({
    data: {
      clientId: p.clientId,
      projectId: p.id,
      templateId: p.template.id,
      studioTemplateId: cat.studioTemplate.templateId,
      studioVersion: cat.studioTemplate.version,
      catalogRevision: cat.catalogRevision,
      requestId,
      answererKind: body.answerer,
      assigneeSmeUserId: body.answerer === 'sme' ? body.smeUserId! : null,
      secondCheck: body.secondCheck,
      note: body.note || null,
      dueBy: body.dueBy ? new Date(`${body.dueBy}T00:00:00Z`) : null,
      createdById: actorUserId,
      items: {
        create: picked.map((w) => ({
          clientId: p.clientId,
          familyId: w!.family.familyId,
          familyName: w!.family.name,
          variantId: w!.variant.variantId,
          tag: w!.variant.tag,
          name: w!.variant.name,
          description: w!.variant.description,
          boundary: w!.variant.boundary,
          // The outcome on record, else Studio's proposal (a fixture's current reference answer), to confirm or change.
          ...((w!.variant.outcome ?? w!.variant.proposedOutcome) ? { proposedOutcome: (w!.variant.outcome ?? w!.variant.proposedOutcome) as unknown as Prisma.InputJsonValue } : {}),
        })),
      },
    },
    include: { items: true },
  });
  await audit({ entityType: 'OutcomeBatch', entityId: batch.id, action: 'outcome_batch.created', after: { projectId: p.id, requestId, answerer: body.answerer, smeUserId: batch.assigneeSmeUserId, secondCheck: body.secondCheck, variants: body.variantIds } });
  return batch;
}

/** Who may answer, check or send a batch. */
function mayAnswer(b: OutcomeBatch, who: Who) {
  return b.answererKind === 'admin' ? who.kind === 'admin' : who.kind === 'sme' && who.smeUserId === b.assigneeSmeUserId;
}

export async function answerItem(tx: Tx, batchId: string, itemId: string, who: Who, answer: OutcomeAnswer, fields: OutcomeField[], audit: Audit, scope: { clientId: string; projectId?: string }) {
  const b = await tx.outcomeBatch.findFirst({ where: { id: batchId, clientId: scope.clientId, ...(scope.projectId ? { projectId: scope.projectId } : {}) } });
  if (!b) throw notFound('Batch not found');
  if (!mayAnswer(b, who)) throw forbidden(b.answererKind === 'admin' ? 'This batch is answered in the console by a PM or Admin.' : 'This batch is assigned to another SME.');
  if (b.state !== 'open') throw new AppError(409, 'BATCH_CLOSED', 'This batch was already submitted.');
  const item = await tx.outcomeBatchItem.findFirst({ where: { id: itemId, batchId } });
  if (!item) throw notFound('Item not found');
  const problems = answerProblems(answer, fields);
  if (problems.length) throw new AppError(422, 'OUTCOME_INVALID', problems.join(' '), { problems });
  const row = await tx.outcomeBatchItem.update({ where: { id: item.id }, data: { answer: answer as unknown as Prisma.InputJsonValue, answeredById: whoId(who), answeredByKind: who.kind, answeredAt: new Date(), checkedById: null, checkedByKind: null, checkedAt: null } });
  await audit({ entityType: 'OutcomeBatch', entityId: b.id, action: 'outcome_batch.answered', before: item.answer ? { answer: item.answer } : undefined, after: { itemId: item.id, variantId: item.variantId, verdict: answer.verdict, by: pseudonym(who.kind, whoId(who)) } });
  return row;
}

/** The outcome-request.v1 body for a batch (every item answered; checked when the batch asks for it). */
export function outcomeRequestBody(b: OutcomeBatch & { items: OutcomeBatchItem[] }) {
  const outcomes = b.items.map((i) => {
    const a = i.answer as OutcomeAnswer;
    const base = { variant_id: i.variantId, family_id: i.familyId, verdict: a.verdict, counts: a.verdict !== 'reject', rationale: a.rationale, written_by: pseudonym(i.answeredByKind ?? 'sme', i.answeredById ?? ''), ...(i.checkedById ? { checked_by: pseudonym(i.checkedByKind ?? 'sme', i.checkedById), checked_at: i.checkedAt!.toISOString() } : {}) };
    return a.verdict === 'confirm' ? { ...base, decision: a.decision, fields: a.fields, evidence: a.evidence } : { ...base, evidence: [] };
  });
  const body = { schema: OUTCOME_REQUEST_SCHEMA, request_id: b.requestId, template: { id: b.studioTemplateId, version: b.studioVersion }, outcomes, second_check: b.secondCheck };
  return { ...body, request_sha256: jcsSha256(body) };
}

/** Checks that a batch can be submitted by this person; returns it with its items. */
export async function readyToSubmit(db: Db | Tx, batchId: string, who: Who, scope: { clientId: string; projectId?: string }) {
  const b = await db.outcomeBatch.findFirst({ where: { id: batchId, clientId: scope.clientId, ...(scope.projectId ? { projectId: scope.projectId } : {}) }, include: { items: { orderBy: { familyId: 'asc' } } } });
  if (!b) throw notFound('Batch not found');
  const missing = b.items.filter((i) => !i.answer);
  if (b.state === 'sent') throw new AppError(409, 'ALREADY_SENT', 'This batch was already written to Studio.');
  if (b.state === 'open') {
    if (!mayAnswer(b, who)) throw forbidden('Only the person answering this batch can submit it.');
    if (missing.length) throw new AppError(422, 'UNANSWERED', `${missing.length} variant${missing.length === 1 ? '' : 's'} still need an answer.`);
  }
  if (b.state === 'awaiting_check') {
    // The checker is someone other than the writer of every item.
    if (b.items.some((i) => i.answeredById === whoId(who))) throw forbidden('The second check must be done by someone other than the person who answered.');
  }
  return b;
}

/**
 * Submit (or check): with a second check asked and not yet done, the batch waits for the checker; otherwise it is
 * written to Studio. `send` is the Studio call, made by the caller outside the transaction.
 */
export async function recordSubmission(tx: Tx, b: OutcomeBatch & { items: OutcomeBatchItem[] }, who: Who, result: StudioResult | null, audit: Audit) {
  const now = new Date();
  if (b.state === 'open' && b.secondCheck) {
    await tx.outcomeBatch.update({ where: { id: b.id }, data: { state: 'awaiting_check', submittedAt: now } });
    await audit({ entityType: 'OutcomeBatch', entityId: b.id, action: 'outcome_batch.submitted_for_check', after: { by: pseudonym(who.kind, whoId(who)) } });
    return { state: 'awaiting_check' as const };
  }
  const body = outcomeRequestBody(b);
  const ok = !!result?.ok;
  await tx.outcomeBatch.update({ where: { id: b.id }, data: { state: ok ? 'sent' : 'send_failed', submittedAt: b.submittedAt ?? now, ...(ok ? { sentAt: now } : {}), sendOutcome: result ? (result.ok ? 'received' : result.kind) : 'not_connected', sendResponse: (result ? (result.ok ? result.data : { code: result.code, message: result.message }) : { code: 'NOT_CONNECTED' }) as Prisma.InputJsonValue, requestSha256: body.request_sha256 } });
  await audit({ entityType: 'OutcomeBatch', entityId: b.id, action: ok ? 'outcome_batch.sent' : 'outcome_batch.send_failed', after: { requestId: b.requestId, requestSha256: body.request_sha256, outcomes: body.outcomes.map((o) => ({ variant: o.variant_id, verdict: o.verdict })), ...(result && !result.ok ? { code: result.code } : {}) } });
  return { state: ok ? ('sent' as const) : ('send_failed' as const), ...(result && !result.ok ? { error: result.message } : {}) };
}

/** Marks every item of a batch as checked by `who` (the second check), before it is written to Studio. */
export async function markChecked(tx: Tx, b: OutcomeBatch & { items: OutcomeBatchItem[] }, who: Who) {
  const at = new Date();
  await tx.outcomeBatchItem.updateMany({ where: { batchId: b.id }, data: { checkedById: whoId(who), checkedByKind: who.kind, checkedAt: at } });
  return { ...b, items: b.items.map((i) => ({ ...i, checkedById: whoId(who), checkedByKind: who.kind, checkedAt: at })) };
}

export const batchDto = (b: OutcomeBatch & { items: OutcomeBatchItem[] }) => ({
  id: b.id,
  requestId: b.requestId,
  answerer: b.answererKind,
  assigneeSmeUserId: b.assigneeSmeUserId,
  secondCheck: b.secondCheck,
  note: b.note,
  dueBy: b.dueBy?.toISOString().slice(0, 10) ?? null,
  state: b.state,
  createdAt: b.createdAt.toISOString(),
  sentAt: b.sentAt?.toISOString() ?? null,
  sendError: b.state === 'send_failed' ? ((b.sendResponse as { message?: string } | null)?.message ?? 'Studio did not take the batch.') : null,
  items: b.items.map((i) => ({ id: i.id, familyId: i.familyId, familyName: i.familyName, variantId: i.variantId, tag: i.tag, name: i.name, description: i.description, boundary: i.boundary, proposedOutcome: i.proposedOutcome, answer: i.answer, answeredAt: i.answeredAt?.toISOString() ?? null, checkedAt: i.checkedAt?.toISOString() ?? null })),
});
