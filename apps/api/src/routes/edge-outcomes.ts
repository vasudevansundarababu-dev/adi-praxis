import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { familyCatalog } from '../anvil/edge-family-catalog';
import type { StudioClient, StudioResult } from '../anvil/studio-client';
import type { Db } from '../db';
import { notFound } from '../lib/errors';
import { runCandidateCommandPrepared, runCommand, runCandidateCommand, runCommandPrepared } from '../platform/command';
import { answerItem, batchDto, createBatch, markChecked, NewOutcomeBatch, OutcomeAnswer, outcomeRequestBody, readyToSubmit, recordSubmission, waitingVariants, type Who } from '../forge/outcome-batches';
import { loadProject } from './projects';

const ACCESS = ['ADMIN', 'PM'] as const;
const Id = z.object({ id: z.string().uuid() });
const BatchParams = Id.extend({ batchId: z.string().uuid() });
const ItemParams = BatchParams.extend({ itemId: z.string().uuid() });
const MeBatch = z.object({ batchId: z.string().uuid() });
const MeItem = MeBatch.extend({ itemId: z.string().uuid() });

/**
 * E-001 §6b (owner, 24 Nov 2026): edge-case variant outcomes in one batch. Console (PM/Admin): the variants waiting for
 * an outcome, make a batch for one SME or answer it as Admin acting for an SME, check and write it to Studio. SME app:
 * the batches assigned to me, answer, submit.
 */
export const edgeOutcomeRoutes: FastifyPluginAsyncZod<{ db: Db; studio: StudioClient | null }> = async (app, { db, studio }) => {
  /** Writes the batch to Studio (outside the transaction), unless it now waits for its second check. */
  const send = async (b: Awaited<ReturnType<typeof readyToSubmit>>, who: Who): Promise<{ b: typeof b; result: StudioResult | null }> => {
    if (b.state === 'open' && b.secondCheck) return { b, result: null };
    const ready = b.state === 'awaiting_check' ? { ...b, items: b.items.map((i) => ({ ...i, checkedById: who.kind === 'admin' ? who.userId : who.smeUserId, checkedByKind: who.kind, checkedAt: new Date() })) } : b;
    const body = outcomeRequestBody(ready);
    return { b, result: studio ? await studio.writeOutcomes(body as unknown as Record<string, unknown>, body.request_sha256) : null };
  };

  app.get('/projects/:id/edge-outcomes', { config: { access: ACCESS }, schema: { tags: ['projects'], params: Id } }, async (req) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    const cat = await familyCatalog(db, p.template, studio, { fresh: true });
    const batches = await db.outcomeBatch.findMany({ where: { projectId: p.id, clientId: req.actor!.clientId }, orderBy: { createdAt: 'desc' }, include: { items: true } });
    const inOpen = new Set(batches.filter((b) => b.state === 'open' || b.state === 'awaiting_check').flatMap((b) => b.items.map((i) => i.variantId)));
    const tasks = await db.taskInstance.findMany({ where: { projectId: p.id }, select: { reviewerSmeUserId: true, assignedTo: { select: { smeUserId: true } } } });
    const ids = [...new Set(tasks.flatMap((t) => [t.assignedTo?.smeUserId, t.reviewerSmeUserId]).filter((x): x is string => !!x))];
    const people = await db.smeUser.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, contactEmail: true } });
    return {
      catalog: { source: cat.source, fallbackReason: cat.fallbackReason, environmentKey: cat.environmentKey, revision: cat.catalogRevision, outcomeFields: cat.outcomeFields },
      waiting: waitingVariants(cat.families).map((w) => ({ familyId: w.family.familyId, familyName: w.family.name, variantId: w.variant.variantId, name: w.variant.name, boundary: w.variant.boundary, migrated: !!w.variant.outcome, fixture: w.variant.kind === 'fixture', proposed: !w.variant.outcome && !!w.variant.proposedOutcome, inBatch: inOpen.has(w.variant.variantId) })),
      people: people.map((s) => ({ smeUserId: s.id, name: s.displayName || s.contactEmail || 'SME' })),
      batches: batches.map(batchDto),
    };
  });

  app.post('/projects/:id/edge-outcomes/batches', { config: { access: ACCESS }, schema: { tags: ['projects'], params: Id, body: NewOutcomeBatch } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await loadProject(tx, req.params.id, actor);
      const cat = await familyCatalog(tx, p.template, studio, { fresh: true });
      return { status: 201, body: batchDto(await createBatch(tx, p, cat, actor.userId, req.body, audit)) };
    });
    return reply;
  });

  app.put('/projects/:id/edge-outcomes/batches/:batchId/items/:itemId', { config: { access: ACCESS }, schema: { tags: ['projects'], params: ItemParams, body: OutcomeAnswer } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await loadProject(tx, req.params.id, actor);
      const cat = await familyCatalog(tx, p.template, studio);
      const row = await answerItem(tx, req.params.batchId, req.params.itemId, { kind: 'admin', userId: actor.userId }, req.body, cat.outcomeFields, audit, { clientId: actor.clientId, projectId: p.id });
      return { status: 200, body: { id: row.id, answer: row.answer, answeredAt: row.answeredAt?.toISOString() ?? null } };
    });
    return reply;
  });

  // Submit an Admin batch, or do a batch's second check; then it is written to Studio.
  app.post('/projects/:id/edge-outcomes/batches/:batchId/send', { config: { access: ACCESS }, schema: { tags: ['projects'], params: BatchParams, body: z.object({}).strict() } }, async (req, reply) => {
    await runCommandPrepared(
      db,
      req,
      reply,
      async (actor) => {
        const p = await loadProject(db, req.params.id, actor);
        const who: Who = { kind: 'admin', userId: actor.userId };
        return { who, ...(await send(await readyToSubmit(db, req.params.batchId, who, { clientId: actor.clientId, projectId: p.id }), who)) };
      },
      async ({ tx, audit }, { who, b, result }) => {
        const batch = b.state === 'awaiting_check' ? await markChecked(tx, b, who) : b;
        const out = await recordSubmission(tx, batch, who, result, audit);
        return { status: out.state === 'send_failed' ? 502 : 200, body: out.state === 'send_failed' ? { error: 'STUDIO_NOT_TAKEN', message: `Studio did not take the batch: ${out.error ?? 'not connected'}. Your answers are kept; send again.` } : out };
      },
    );
    return reply;
  });

  // ── SME app ──
  app.get('/me/edge-outcomes', { config: { access: 'candidate' }, schema: { tags: ['work'] } }, async (req) => {
    const me = req.candidate!;
    const batches = await db.outcomeBatch.findMany({ where: { clientId: me.clientId, assigneeSmeUserId: me.smeUserId }, orderBy: { createdAt: 'desc' }, include: { items: true } });
    const projects = new Map((await db.project.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.projectId))] } }, include: { template: true } })).map((p) => [p.id, p]));
    const fields = new Map<string, unknown>();
    for (const p of projects.values()) fields.set(p.id, (await familyCatalog(db, p.template, studio)).outcomeFields);
    return { items: batches.map((b) => ({ ...batchDto(b), projectName: projects.get(b.projectId)?.name ?? 'Project', outcomeFields: fields.get(b.projectId) ?? [] })) };
  });

  app.put('/me/edge-outcomes/:batchId/items/:itemId', { config: { access: 'candidate' }, schema: { tags: ['work'], params: MeItem, body: OutcomeAnswer } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const b = await tx.outcomeBatch.findFirst({ where: { id: req.params.batchId, clientId: actor.clientId } });
      if (!b) throw notFound('Batch not found');
      const p = await tx.project.findUniqueOrThrow({ where: { id: b.projectId }, include: { template: true } });
      const cat = await familyCatalog(tx, p.template, studio);
      const row = await answerItem(tx, b.id, req.params.itemId, { kind: 'sme', smeUserId: actor.smeUserId }, req.body, cat.outcomeFields, audit, { clientId: actor.clientId });
      return { status: 200, body: { id: row.id, answer: row.answer, answeredAt: row.answeredAt?.toISOString() ?? null } };
    });
    return reply;
  });

  app.post('/me/edge-outcomes/:batchId/submit', { config: { access: 'candidate' }, schema: { tags: ['work'], params: MeBatch, body: z.object({}).strict() } }, async (req, reply) => {
    await runCandidateCommandPrepared(
      db,
      req,
      reply,
      async (actor) => {
        const who: Who = { kind: 'sme', smeUserId: actor.smeUserId };
        return { who, ...(await send(await readyToSubmit(db, req.params.batchId, who, { clientId: actor.clientId }), who)) };
      },
      async ({ tx, audit }, { who, b, result }) => {
        const out = await recordSubmission(tx, b, who, result, audit);
        return { status: out.state === 'send_failed' ? 502 : 200, body: out.state === 'send_failed' ? { error: 'STUDIO_NOT_TAKEN', message: `Studio did not take the batch: ${out.error ?? 'not connected'}. Your answers are kept; submit again.` } : out };
      },
    );
    return reply;
  });
};
