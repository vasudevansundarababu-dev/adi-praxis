import { Prisma } from '@prisma/client';
import { CAPPED_TASK_STATUSES, identityEligible, OPEN_TASK_STATUSES, SaveTaskRequest, SubmitTaskRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import { runCandidateCommand } from '../platform/command';
import type { SelectionGate } from '../staffing/selection-gate';
import type { EmbeddingProvider } from '../tasks/embeddings';
import { definitionFor } from '../tasks/definitions';
import { redeemInvite } from '../tasks/invites';
import { findSimilar } from '../tasks/similarity';
import { evaluateTask, submitTask, type StoredChecks } from '../tasks/submission';
import { activeAssignment, allocateTasks, templateRef } from '../tasks/task-service';
import { conversationInputProblems } from '../tasks/conversation/guards';
import { allowEditor, experienceOf } from '../tasks/authoring-experience';
import { AUTHORSHIP_VERSION } from '../tasks/conversation/authorship';
import { chatOf, draftingWith } from '../tasks/conversation/service';
import { effectivePolicy, sidecar } from '../policy/task-policy';
import { profileSaveProblems } from '../tasks/profile-output';

const IdParams = z.object({ id: z.string().uuid() });

/** What still stands between this candidate and the project's tasks (SPEC FLOW 3, candidate login step 4). */
type Step = { step: 'identity' | 'account' | 'accept' | 'onboarding' | 'eligibility' | 'not_assigned'; message: string; href: string | null };

export async function workContext(tx: Db | Tx, gate: SelectionGate, smeUserId: string, projectId: string): Promise<{ ok: true; candidateId: string; paId: string } | ({ ok: false } & Step)> {
  const u = await tx.smeUser.findUniqueOrThrow({ where: { id: smeUserId } });
  if (u.accountStatus !== 'ACTIVE') return { ok: false, step: 'account', message: 'Your account is not active. Contact support.', href: null };
  if (!identityEligible(u.identityStatus)) return { ok: false, step: 'identity', message: 'Verify your identity to open tasks.', href: '/verify' };
  const candidate = await tx.candidate.findUnique({ where: { smeUserId } });
  const sa = await tx.smeAssignment.findFirst({ where: { smeUserId, projectId }, orderBy: { createdAt: 'desc' } });
  if (sa?.status === 'PROPOSED') return { ok: false, step: 'accept', message: 'Accept the assignment on your home page first.', href: '/home' };
  const pa = candidate ? await activeAssignment(tx, projectId, candidate.id) : null;
  if (!candidate || !pa) return { ok: false, step: 'not_assigned', message: 'You are not assigned to this project.', href: '/home' };
  const g = await gate.check(tx, { candidateId: candidate.id, projectId });
  if (!g.ok) {
    const onboarding = /onboarding|terms|checklist/.test(g.reason);
    return { ok: false, step: onboarding ? 'onboarding' : 'eligibility', message: `Before you can work on this project: ${g.reason}.`, href: onboarding && sa ? `/enrollments/${sa.enrollmentId}/onboarding` : '/home' };
  }
  return { ok: true, candidateId: candidate.id, paId: pa.id };
}

export function outstanding(s: Step): never {
  throw new AppError(409, 'OUTSTANDING_STEP', s.message, s);
}

export async function ownTask(tx: Db | Tx, taskId: string, smeUserId: string) {
  const t = await tx.taskInstance.findFirst({ where: { id: taskId, assignedTo: { smeUserId } }, include: { project: { include: { template: true } }, reviews: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!t) throw notFound('Task not found');
  return t;
}

const taskSummary = (t: { id: string; status: string; taskType: string; input: unknown; submittedAt: Date | null; activeSeconds: number; assignedAt: Date | null; revision: number }) => ({
  id: t.id,
  status: t.status,
  taskType: t.taskType,
  brief: (t.input as { slot?: { brief?: string } }).slot?.brief ?? null,
  isOpenSlot: (t.input as { slot?: { isOpen?: boolean } }).slot?.isOpen ?? false,
  assignedAt: t.assignedAt?.toISOString() ?? null,
  submittedAt: t.submittedAt?.toISOString() ?? null,
  activeSeconds: t.activeSeconds,
  revision: t.revision,
});

/** FLOW 3 for candidates: invite, project task list, pull, autosave, check and submit. */
export const workRoutes: FastifyPluginAsyncZod<{ db: Db; selectionGate: SelectionGate; embeddings: EmbeddingProvider }> = async (app, { db, selectionGate, embeddings }) => {
  app.post('/me/invites/redeem', { config: { access: 'candidate', rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['work'], body: z.object({ token: z.string().min(20).max(200) }) } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => ({ status: 200, body: await redeemInvite(tx, req.body.token, actor.smeUserId, audit) }));
    return reply;
  });

  app.get('/me/projects', { config: { access: 'candidate' }, schema: { tags: ['work'] } }, async (req) => {
    const candidate = await db.candidate.findUnique({ where: { smeUserId: req.candidate!.smeUserId } });
    if (!candidate) return { items: [] };
    const pas = await db.projectAssignment.findMany({ where: { candidateId: candidate.id, releasedAt: null }, include: { project: true, smeAssignment: true } });
    const accepted = pas.filter((p) => !p.smeAssignment || ['ACCEPTED', 'HANDED_OFF'].includes(p.smeAssignment.status));
    const counts = await db.taskInstance.groupBy({ by: ['projectId', 'status'], where: { assignedToId: candidate.id, projectId: { in: accepted.map((p) => p.projectId) } }, _count: true });
    return {
      items: accepted.map((p) => ({
        projectId: p.projectId,
        name: p.project.name,
        status: p.project.status,
        taskMode: p.project.taskMode,
        counts: Object.fromEntries(counts.filter((c) => c.projectId === p.projectId).map((c) => [c.status, c._count])),
      })),
    };
  });

  // A candidate sees only tasks from projects they are assigned to; anything missing names the outstanding step.
  app.get('/me/projects/:id', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const ctx = await workContext(db, selectionGate, req.candidate!.smeUserId, req.params.id);
    if (!ctx.ok) outstanding(ctx);
    const p = await db.project.findUniqueOrThrow({ where: { id: req.params.id }, include: { template: true } });
    const tasks = await db.taskInstance.findMany({ where: { projectId: p.id, assignedToId: ctx.candidateId }, orderBy: { assignedAt: 'asc' } });
    const open = tasks.filter((t) => (OPEN_TASK_STATUSES as readonly string[]).includes(t.status)).length;
    const capped = tasks.filter((t) => (CAPPED_TASK_STATUSES as readonly string[]).includes(t.status)).length;
    const cap = p.taskMode === 'AUTHORING' ? p.maxPerExpert : null;
    return {
      project: { id: p.id, name: p.name, status: p.status, taskMode: p.taskMode, tptMinutes: p.tptMinutes, workflow: p.template.workflowName, humanGate: p.template.humanGate },
      tasks: tasks.map(taskSummary),
      limits: { openCap: p.openTaskCapPerCandidate, open, perExpertCap: cap, used: capped },
      canPull: p.status !== 'PAUSED' && open < p.openTaskCapPerCandidate && (cap === null || capped < cap),
    };
  });

  app.post('/me/projects/:id/tasks/next', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const ctx = await workContext(tx, selectionGate, actor.smeUserId, req.params.id);
      if (!ctx.ok) outstanding(ctx);
      const [t] = await allocateTasks(tx, { projectId: req.params.id, candidateId: ctx.candidateId, want: 1 }, audit);
      if (!t) throw new AppError(409, 'NO_TASK', 'No task is available for you right now: you may be at your limit, or every suitable slot is taken.');
      return { status: 200, body: taskSummary(t) };
    });
    return reply;
  });

  app.get('/me/tasks/:id', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const template = await templateRef(db, t.project.templateId);
    const checks = t.checks as StoredChecks | null;
    const review = t.reviews[0];
    return {
      ...taskSummary(t),
      projectId: t.projectId,
      projectName: t.project.name,
      authoringExperience: t.project.authoringExperience,
      effectiveAuthoringExperience: experienceOf(t.project),
      authoringWorkspace: (t.drafting as { workspace?: unknown } | null)?.workspace ?? null,
      tptMinutes: t.project.tptMinutes,
      definition: definitionFor(template).key,
      template: {
        workflow: template.workflowName,
        domain: template.domainName,
        primaryWork: t.project.template.primaryWork,
        verificationCriteria: t.project.template.verificationCriteria,
        humanGate: t.project.template.humanGate,
        coverageDimensions: template.coverageDimensions,
        edgeCases: template.edgeCases,
        collectionSchema: template.collectionSchema,
      },
      input: t.input,
      output: t.quarantinedAt ? null : t.output,
      coverageTags: t.coverageTags,
      checks: checks?.results ?? null,
      exportStatus: checks?.export ?? null,
      // Authors see only the closest tasks' briefs, never other authors' content.
      readOnly: !['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status),
      review: review ? { decision: review.decision, comments: review.comments, notes: review.notes, rejectReason: review.rejectReason, at: review.createdAt.toISOString() } : null,
    };
  });

  // OD9: the SME sees the agent-visible rules of their own task, read-only. Evaluator-only rules never leave the server.
  app.get('/me/tasks/:id/policy', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const snap = await db.taskPolicySnapshot.findFirst({ where: { taskInstanceId: t.id }, orderBy: { version: 'desc' } });
    if (snap) return { configured: true, readOnly: true, ...sidecar(snap, { agentVisibleOnly: true }) };
    const eff = await effectivePolicy(db, t.clientId, t);
    if (!eff) return { configured: false, readOnly: true, rules: [], task_changes: [] };
    const rules = eff.body.rules.filter((r) => r.visibility === 'agent_visible');
    const visible = new Set(rules.map((r) => r.rule_version_id));
    return { configured: true, readOnly: true, snapshot_id: null, project_rule_set: eff.body.project_rule_set, rules, task_changes: eff.body.task_changes.filter((x) => visible.has(x.rule_version_id)) };
  });

  // W01: a sample accepted task of the same workflow from a different coverage cell (accepted content is synthetic).
  app.get('/me/tasks/:id/sample', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const mine = JSON.stringify(t.coverageTags ?? null);
    const recent = await db.approvedTaskRecord.findMany({
      where: { clientId: t.clientId, workflow: t.project.template.workflowName, supersedesId: null, taskMode: 'AUTHORING' },
      orderBy: { seq: 'desc' },
      take: 20,
      select: { output: true, coverageTags: true },
    });
    const other = recent.find((r) => JSON.stringify(r.coverageTags) !== mine);
    return other ? { source: 'dataset', coverageTags: other.coverageTags, output: other.output } : { source: 'none', coverageTags: null, output: null };
  });

  // Autosave (TASK-KYC W01–W06): the draft, time actively spent, and optimistic concurrency by revision.
  app.post('/me/tasks/:id/authoring-workspace', {config:{access:'candidate'}, schema:{params:IdParams,body:z.object({view:z.enum(['CLASSIC','CHATBOT']),answer:z.string().max(4000)}).strict()}},async(req,reply)=>{
    await runCandidateCommand(db,req,reply,async({tx,actor,audit})=>{
      await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${req.params.id}::uuid FOR UPDATE`;
      const t=await ownTask(tx,req.params.id,actor.smeUserId);const ctx=await workContext(tx,selectionGate,actor.smeUserId,t.projectId);if(!ctx.ok)outstanding(ctx);
      if(t.taskType!=='AUTHORING'||!['ASSIGNED','IN_PROGRESS','REWORK'].includes(t.status)||t.quarantinedAt)throw new AppError(409,'READ_ONLY','This task is read-only.');
      if(t.project.status==='PAUSED')throw new AppError(409,'PROJECT_PAUSED','Project is paused.');
      allowEditor(t.project,req.body.view);
      if(req.body.answer && t.project.authoringExperience==='CLASSIC')throw new AppError(403,'AUTHORING_VIEW_DISABLED','Chatbot is disabled.');
      if(req.body.answer&&conversationInputProblems(req.body.answer).length)throw new AppError(422,'UNSAFE_INPUT','Remove sensitive data or instruction override attempts before saving.');
      const workspace={view:req.body.view,answer:req.body.answer};
      await tx.taskInstance.update({where:{id:t.id},data:{drafting:{...((t.drafting??{}) as object),workspace} as Prisma.InputJsonValue}});
      await audit({entityType:'TaskInstance',entityId:t.id,action:'task.workspace.saved',after:{view:req.body.view}});
      return {status:200,body:workspace};
    });return reply;
  });

  app.put('/me/tasks/:id', { config: { access: 'candidate', rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: IdParams, body: SaveTaskRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${req.params.id}::uuid FOR UPDATE`;
      const t = await ownTask(tx, req.params.id, actor.smeUserId);
      if (t.taskType === 'AUTHORING') {
        allowEditor(t.project,'CLASSIC');
        if (t.project.authoringExperience && chatOf(t).consent?.version !== AUTHORSHIP_VERSION) throw new AppError(409,'AUTHORSHIP_CONSENT_REQUIRED','Accept the human-authorship terms before editing.');
      }
      const ctx = await workContext(tx, selectionGate, actor.smeUserId, t.projectId);
      if (!ctx.ok) outstanding(ctx);
      if (!['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status)) throw new AppError(409, 'READ_ONLY', 'This task is read-only now.');
      if (t.project.status === 'PAUSED') throw new AppError(409, 'PROJECT_PAUSED', 'This project is paused. Your work is saved; you can continue when it resumes.');
      const shape = t.taskType === 'AUTHORING' ? profileSaveProblems(t.project.template.workflowName, req.body.output) : [];
      if (shape.length) throw new AppError(422, 'INVALID_PROFILE_OUTPUT', 'This draft does not match the template profile.', { problems: shape });
      const now = new Date();
      const { count } = await tx.taskInstance.updateMany({
        where: { id: t.id, revision: req.body.expectedRevision },
        data: {
          ...(t.taskType === 'AUTHORING' && t.project.authoringExperience ? {drafting: JSON.parse(JSON.stringify(draftingWith(t,{...chatOf(t),humanOnly:true,declaration:undefined,needsReview:true}))) as Prisma.InputJsonValue} : {}),
          output: req.body.output as Prisma.InputJsonValue,
          status: 'IN_PROGRESS',
          startedAt: t.startedAt ?? now,
          lastSavedAt: now,
          activeSeconds: { increment: req.body.activeSecondsDelta },
          revision: { increment: 1 },
        },
      });
      if (!count) throw new AppError(409, 'STALE_REVISION', 'This task changed in another window. Reload to continue.', { revision: t.revision });
      if (t.slotId && t.status === 'ASSIGNED') await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
      if (t.status !== 'IN_PROGRESS') await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.started', before: { status: t.status }, after: { status: 'IN_PROGRESS' } });
      else await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.saved', after: { revision: t.revision + 1, activeSecondsDelta: req.body.activeSecondsDelta } });
      return { status: 200, body: { revision: t.revision + 1, savedAt: now.toISOString() } };
    });
    return reply;
  });

  // W06: run every automated check now (no state change) and show the closest existing tasks' briefs.
  app.post('/me/tasks/:id/check', { config: { access: 'candidate', rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const ev = await evaluateTask(db, t);
    let similar: { brief: string | null; score: number; flagged: boolean }[] = [];
    if (t.taskType === 'AUTHORING' && t.output) {
      const matches = await findSimilar(db, { taskId: t.id, lineageId: ev.lineageId, embedding: await embeddings.embed(ev.text), coverage: ev.coverage, keyInputs: ev.keyInputs, threshold: ev.threshold, limit: 3 });
      const others = await db.taskInstance.findMany({ where: { id: { in: matches.map((m) => m.taskId) } }, select: { id: true, input: true } });
      similar = matches.map((m) => ({ brief: ((others.find((o) => o.id === m.taskId)?.input ?? {}) as { slot?: { brief?: string } }).slot?.brief ?? null, score: Math.round(Math.max(m.embeddingScore, m.structuredScore) * 100) / 100, flagged: m.flagged }));
    }
    return { checks: ev.checks, flags: ev.flags, similar };
  });

  app.post('/me/tasks/:id/submit', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams, body: SubmitTaskRequest } }, async (req, reply) => {
    // The embedding (a model call) is computed before the transaction; the revision check keeps it consistent.
    const pre = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    let embedding: number[] | null = null;
    if (pre.taskType === 'AUTHORING' && pre.output && pre.revision === req.body.expectedRevision) {
      const ev = await evaluateTask(db, pre);
      // Every authored task is compared before review; if the embedding service is down, submission waits.
      embedding = await embeddings.embed(ev.text).catch(() => {
        throw new AppError(503, 'SIMILARITY_UNAVAILABLE', 'The duplicate check is unavailable right now. Your work is saved; try submitting again shortly.');
      });
    }
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
      const t = await ownTask(tx, req.params.id, actor.smeUserId);
      const ctx = await workContext(tx, selectionGate, actor.smeUserId, t.projectId);
      if (!ctx.ok) outstanding(ctx);
      if (t.project.status === 'PAUSED') throw new AppError(409, 'PROJECT_PAUSED', 'This project is paused. Your work is saved; you can submit when it resumes.');
      const r = await submitTask(tx, { task: t, body: req.body, embedding, embeddingModel: embedding ? embeddings.model : null }, audit, emit);
      return { status: 200, body: { status: 'SUBMITTED', version: r.version } };
    });
    return reply;
  });
};
