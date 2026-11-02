import '@fastify/multipart';
import { Prisma, type Opportunity, type OpportunityVersion } from '@prisma/client';
import {
  OpportunityBrief,
  OpportunityCriteria,
  opportunityPublishProblems,
  QuestionPolicy,
  reconcilePolicy,
  PublicOpportunityDto,
  SaveOpportunityDraftRequest,
} from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { extractDocumentText, MAX_DOCUMENT_BYTES } from '../candidate/document-text';
import { ensureConversation } from '../candidate/profile-service';
import type { Db, Tx } from '../db';
import type { Config } from '../config';
import { applicationBlockReason } from '../candidate/identity-service';
import { sha256 } from '../lib/crypto';
import { AppError, badRequest, notFound } from '../lib/errors';
import type { writeAudit } from '../platform/audit';
import { runCandidateCommand, runCommand } from '../platform/command';
import { loadProject } from './projects';

const IdParams = z.object({ id: z.string().uuid() });
const ACCESS = ['PM', 'ADMIN'] as const;
const OPEN_PROJECT = ['READY_FOR_STAFFING', 'STAFFING', 'STAFFED', 'IN_PROGRESS', 'PAUSED'];

/** Default draft built from the submitted project: JD snapshot, template and FLOW2 guidance. */
async function defaultDraft(tx: Db | Tx, projectId: string) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: { template: { include: { domain: true } }, jdSnapshot: true } });
  const jd = (p.jdSnapshot?.data ?? {}) as { title?: string; responsibilities?: string; skills?: string[]; wagePerTask?: number; wageCurrency?: string; locationType?: string; location?: string | null };
  const brief = OpportunityBrief.parse({
    title: jd.title ?? p.name,
    summary: jd.responsibilities ?? '',
    domain: p.template.domain.name,
    specialty: p.template.workflowName,
    contributionRoles: p.taskMode === 'AUTHORING' ? ['TASK_AUTHOR'] : ['ANNOTATOR'],
    // SPEC: wage and location are shown on every job post.
    compensation: jd.wagePerTask ? `${jd.wagePerTask} ${jd.wageCurrency} per accepted task` : null,
    timeCommitment: p.tptMinutes ? `About ${p.tptMinutes} minutes per task (a planning target, not a deadline).` : '',
    whatWeWillAsk:
      'A short guided conversation about the work you have actually done: your specialty, roles and responsibilities, the jurisdictions you worked in, a generic description of a typical case, and supporting evidence where it matters.',
    doNotDisclose:
      'Do not share real customer information, account numbers, internal reports or filings, your employer’s non-public policies, or any credentials. Describe work in generic or synthetic terms.',
  });
  const criteria = OpportunityCriteria.parse(
    (jd.skills ?? []).slice(0, 5).map((s, i) => ({ id: `skill-${i + 1}`, text: `Hands-on experience with ${s}`, kind: i === 0 ? 'REQUIRED' : 'PREFERRED' })),
  );
  return { brief, criteria };
}

async function currentDraft(tx: Db | Tx, projectId: string) {
  const o = await tx.opportunity.findUnique({ where: { projectId } });
  if (o?.draftBrief && o.draftCriteria) return { brief: OpportunityBrief.parse(o.draftBrief), criteria: OpportunityCriteria.parse(o.draftCriteria) };
  return defaultDraft(tx, projectId);
}

async function ensureOpportunity(tx: Tx, project: { id: string; clientId: string }) {
  const existing = await tx.opportunity.findUnique({ where: { projectId: project.id } });
  if (existing) return existing;
  const d = await defaultDraft(tx, project.id);
  return tx.opportunity.create({
    data: { clientId: project.clientId, projectId: project.id, draftBrief: d.brief as Prisma.InputJsonValue, draftCriteria: d.criteria as Prisma.InputJsonValue },
  });
}

const latestVersion = (tx: Db | Tx, opportunityId: string) =>
  tx.opportunityVersion.findFirst({ where: { opportunityId, publishedAt: { not: null } }, orderBy: { version: 'desc' } });

function publicDto(o: Opportunity, v: OpportunityVersion): PublicOpportunityDto {
  return {
    id: o.id,
    version: v.version,
    status: o.status,
    brief: OpportunityBrief.parse(v.brief),
    criteria: OpportunityCriteria.parse(v.criteria),
    publishedAt: v.publishedAt?.toISOString() ?? null,
  };
}

const OwnerDto = z.object({
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']),
  draft: z.object({ brief: OpportunityBrief, criteria: OpportunityCriteria }),
  /** The questions candidates will be asked (owner-edited, or generated from the brief and criteria). */
  questionPolicy: QuestionPolicy,
  publishProblems: z.array(z.string()),
  versions: z.array(z.object({ version: z.number().int(), publishedAt: z.string().nullable() })),
  documents: z.array(
    z.object({ id: z.string().uuid(), filename: z.string(), status: z.string(), extractedText: z.string(), confirmedText: z.string().nullable(), createdAt: z.string() }),
  ),
});

async function ownerView(tx: Db | Tx, projectId: string): Promise<z.infer<typeof OwnerDto>> {
  const o = await tx.opportunity.findUnique({
    where: { projectId },
    include: { versions: { orderBy: { version: 'desc' } }, documents: { orderBy: { createdAt: 'desc' } } },
  });
  const draft = await currentDraft(tx, projectId);
  const owned = QuestionPolicy.safeParse(o?.draftQuestionPolicy);
  return {
    projectId,
    opportunityId: o?.id ?? null,
    status: o?.status ?? 'DRAFT',
    draft,
    questionPolicy: reconcilePolicy(owned.success ? owned.data : null, draft.brief, draft.criteria),
    publishProblems: opportunityPublishProblems(draft.brief, draft.criteria),
    versions: (o?.versions ?? []).map((v) => ({ version: v.version, publishedAt: v.publishedAt?.toISOString() ?? null })),
    documents: (o?.documents ?? []).map((d) => ({
      id: d.id,
      filename: d.filename,
      status: d.status,
      extractedText: d.extractedText,
      confirmedText: d.confirmedText,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

/** FLOW2-SME C03: the project's SME opportunity (owner side) and its public, candidate-safe page. */
export const opportunityRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  const ownedProject = async (tx: Db | Tx, id: string, actor: Parameters<typeof loadProject>[2]) => {
    const p = await loadProject(tx, id, actor);
    if (!OPEN_PROJECT.includes(p.status)) throw new AppError(409, 'PROJECT_NOT_OPEN', `Opportunities are managed once a project is submitted (this one is ${p.status}).`);
    return p;
  };

  app.get('/projects/:id/opportunity', { config: { access: ACCESS }, schema: { tags: ['opportunities'], params: IdParams, response: { 200: OwnerDto } } }, async (req) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    return ownerView(db, p.id);
  });

  app.put(
    '/projects/:id/opportunity/draft',
    { config: { access: ACCESS }, schema: { tags: ['opportunities'], params: IdParams, body: SaveOpportunityDraftRequest, response: { 200: OwnerDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await ownedProject(tx, req.params.id, actor);
        const o = await ensureOpportunity(tx, p);
        if (o.status === 'CLOSED') throw new AppError(409, 'OPPORTUNITY_CLOSED', 'This opportunity is closed.');
        let policyUpdate: Prisma.OpportunityUpdateInput = {};
        if (req.body.questionPolicy === null) policyUpdate = { draftQuestionPolicy: Prisma.DbNull };
        else if (req.body.questionPolicy !== undefined) {
          const parsed = QuestionPolicy.safeParse(req.body.questionPolicy);
          if (!parsed.success) throw new AppError(400, 'INVALID_QUESTION_POLICY', 'The question list is not valid.', { problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
          policyUpdate = { draftQuestionPolicy: { ...parsed.data, source: 'owner' } as Prisma.InputJsonValue };
        }
        await tx.opportunity.update({
          where: { id: o.id },
          data: { draftBrief: req.body.brief as Prisma.InputJsonValue, draftCriteria: req.body.criteria as Prisma.InputJsonValue, ...policyUpdate },
        });
        await audit({ entityType: 'Opportunity', entityId: o.id, action: 'opportunity.draft_saved', after: { criteria: req.body.criteria.length } });
        return { status: 200, body: await ownerView(tx, p.id) };
      });
      return reply;
    },
  );

  // Import a JD document. The extracted text is untrusted until the owner confirms it.
  app.post(
    '/projects/:id/opportunity/documents',
    { config: { access: ACCESS }, schema: { tags: ['opportunities'], params: IdParams, response: { 201: OwnerDto } } },
    async (req, reply) => {
      const file = await req.file({ limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1 } });
      if (!file) throw badRequest('Attach a PDF or .docx file');
      const buf = await file.toBuffer();
      if (file.file.truncated) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
      const { kind, text } = await extractDocumentText(buf);
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await ownedProject(tx, req.params.id, actor);
        const o = await ensureOpportunity(tx, p);
        const d = await tx.opportunityDocument.create({
          data: {
            clientId: p.clientId,
            opportunityId: o.id,
            filename: file.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 200),
            mimeType: kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: buf.length,
            sha256: sha256(buf.toString('binary')),
            extractedText: text,
            uploadedById: actor.userId,
          },
        });
        await audit({ entityType: 'OpportunityDocument', entityId: d.id, action: 'opportunity.document_imported', after: { filename: d.filename, sizeBytes: d.sizeBytes, status: 'PENDING_REVIEW' } });
        return { status: 201, body: await ownerView(tx, p.id) };
      });
      return reply;
    },
  );

  app.post(
    '/projects/:id/opportunity/documents/:docId/confirm',
    {
      config: { access: ACCESS },
      schema: { tags: ['opportunities'], params: IdParams.extend({ docId: z.string().uuid() }), body: z.object({ text: z.string().trim().min(1).max(50_000) }), response: { 200: OwnerDto } },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await ownedProject(tx, req.params.id, actor);
        const o = await ensureOpportunity(tx, p);
        const d = await tx.opportunityDocument.findFirst({ where: { id: req.params.docId, opportunityId: o.id, status: 'PENDING_REVIEW' } });
        if (!d) throw notFound('Document awaiting review not found');
        await tx.opportunityDocument.update({ where: { id: d.id }, data: { status: 'CONFIRMED', confirmedText: req.body.text, reviewedById: actor.userId, reviewedAt: new Date() } });
        const draft = await currentDraft(tx, p.id);
        await tx.opportunity.update({
          where: { id: o.id },
          data: { draftBrief: { ...draft.brief, fullDescription: req.body.text } as Prisma.InputJsonValue, draftCriteria: draft.criteria as Prisma.InputJsonValue },
        });
        await audit({ entityType: 'OpportunityDocument', entityId: d.id, action: 'opportunity.document_confirmed', before: { status: 'PENDING_REVIEW' }, after: { status: 'CONFIRMED', edited: req.body.text !== d.extractedText } });
        return { status: 200, body: await ownerView(tx, p.id) };
      });
      return reply;
    },
  );

  app.post(
    '/projects/:id/opportunity/documents/:docId/discard',
    { config: { access: ACCESS }, schema: { tags: ['opportunities'], params: IdParams.extend({ docId: z.string().uuid() }), response: { 200: OwnerDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await ownedProject(tx, req.params.id, actor);
        const d = await tx.opportunityDocument.findFirst({ where: { id: req.params.docId, opportunity: { projectId: p.id }, status: 'PENDING_REVIEW' } });
        if (!d) throw notFound('Document awaiting review not found');
        await tx.opportunityDocument.update({ where: { id: d.id }, data: { status: 'DISCARDED', reviewedById: actor.userId, reviewedAt: new Date() } });
        await audit({ entityType: 'OpportunityDocument', entityId: d.id, action: 'opportunity.document_discarded', before: { status: 'PENDING_REVIEW' }, after: { status: 'DISCARDED' } });
        return { status: 200, body: await ownerView(tx, p.id) };
      });
      return reply;
    },
  );

  // Publishing always needs a human (FLOW2 C03) and freezes the draft into a new version.
  app.post(
    '/projects/:id/opportunity/publish',
    { config: { access: ACCESS }, schema: { tags: ['opportunities'], params: IdParams, response: { 200: OwnerDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await ownedProject(tx, req.params.id, actor);
        const o = await ensureOpportunity(tx, p);
        if (o.status === 'CLOSED') throw new AppError(409, 'OPPORTUNITY_CLOSED', 'This opportunity is closed.');
        const pending = await tx.opportunityDocument.count({ where: { opportunityId: o.id, status: 'PENDING_REVIEW' } });
        if (pending) throw new AppError(409, 'DOCUMENT_PENDING_REVIEW', 'Confirm or discard the imported document before publishing.');
        const draft = await currentDraft(tx, p.id);
        const problems = opportunityPublishProblems(draft.brief, draft.criteria);
        if (problems.length) throw new AppError(422, 'OPPORTUNITY_INCOMPLETE', `Cannot publish yet: ${problems.join('; ')}.`, { problems });
        const last = await tx.opportunityVersion.findFirst({ where: { opportunityId: o.id }, orderBy: { version: 'desc' } });
        const v = await tx.opportunityVersion.create({
          data: {
            clientId: p.clientId,
            opportunityId: o.id,
            version: (last?.version ?? 0) + 1,
            brief: draft.brief as Prisma.InputJsonValue,
            criteria: draft.criteria as Prisma.InputJsonValue,
            // The pinned question policy: owner edits reconciled with the criteria, or the generated default.
            questionPolicy: reconcilePolicy(QuestionPolicy.safeParse(o.draftQuestionPolicy).data ?? null, draft.brief, draft.criteria) as unknown as Prisma.InputJsonValue,
            scope: { domain: draft.brief.domain, specialty: draft.brief.specialty, contributionRoles: draft.brief.contributionRoles },
            ownerId: p.ownerId,
            publishedAt: new Date(),
            publishedById: actor.userId,
          },
        });
        await tx.opportunity.update({ where: { id: o.id }, data: { status: 'PUBLISHED' } });
        await audit({ entityType: 'Opportunity', entityId: o.id, action: 'opportunity.published', before: { status: o.status }, after: { status: 'PUBLISHED', version: v.version } });
        return { status: 200, body: await ownerView(tx, p.id) };
      });
      return reply;
    },
  );

  // Closed pools accept no new enrollments (FLOW2 C03).
  app.post(
    '/projects/:id/opportunity/close',
    { config: { access: ACCESS }, schema: { tags: ['opportunities'], params: IdParams, response: { 200: OwnerDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        const o = await tx.opportunity.findUnique({ where: { projectId: p.id } });
        if (!o || o.status !== 'PUBLISHED') throw new AppError(409, 'NOT_PUBLISHED', 'Only a published opportunity can be closed.');
        await tx.opportunity.update({ where: { id: o.id }, data: { status: 'CLOSED' } });
        await audit({ entityType: 'Opportunity', entityId: o.id, action: 'opportunity.closed', before: { status: 'PUBLISHED' }, after: { status: 'CLOSED' } });
        return { status: 200, body: await ownerView(tx, p.id) };
      });
      return reply;
    },
  );

  // ── Public, candidate-safe (preview before sign-in) ──
  app.get(
    '/opportunities',
    { config: { access: 'public' }, schema: { tags: ['opportunities'], response: { 200: z.object({ items: z.array(PublicOpportunityDto) }) } } },
    async () => {
      const list = await db.opportunity.findMany({ where: { status: 'PUBLISHED' }, orderBy: { updatedAt: 'desc' } });
      const items: PublicOpportunityDto[] = [];
      for (const o of list) {
        const v = await latestVersion(db, o.id);
        if (v) items.push(publicDto(o, v));
      }
      return { items };
    },
  );

  app.get(
    '/opportunities/:id',
    { config: { access: 'public' }, schema: { tags: ['opportunities'], params: IdParams, response: { 200: PublicOpportunityDto } } },
    async (req) => {
      const o = await db.opportunity.findUnique({ where: { id: req.params.id } });
      const v = o ? await latestVersion(db, o.id) : null;
      if (!o || !v || o.status === 'DRAFT') throw notFound('Opportunity not found');
      return publicDto(o, v);
    },
  );

  // "Build my SME profile": start (or reuse) this candidate's enrollment, pinned to the current version.
  app.post(
    '/me/enrollments',
    {
      config: { access: 'candidate' },
      schema: {
        tags: ['candidate'],
        body: z.object({ opportunityId: z.string().uuid(), campaignId: z.string().uuid().optional() }),
        response: { 200: z.object({ id: z.string().uuid(), status: z.string(), opportunityId: z.string().uuid(), version: z.number().int() }) },
      },
    },
    async (req, reply) => {
      await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => ({
        status: 200,
        body: await startOrResumeEnrollment(tx, { clientId: actor.clientId, smeUserId: actor.smeUserId, opportunityId: req.body.opportunityId, campaignId: req.body.campaignId, requireLiveIdentity: config.requireLiveIdentity }, audit),
      }));
      return reply;
    },
  );
};

/** "Build my SME profile": start (or reuse) a candidate's enrollment, pinned to the opportunity's current version. */
export async function startOrResumeEnrollment(tx: Tx, args: { clientId: string; smeUserId: string; opportunityId: string; campaignId?: string; requireLiveIdentity: boolean }, audit: (i: Parameters<typeof writeAudit>[2]) => Promise<void>) {
  const blocked = await applicationBlockReason(tx, args.smeUserId, args.requireLiveIdentity);
  if (blocked) throw new AppError(403, 'AGE_RESTRICTION', blocked);
  const o = await tx.opportunity.findFirst({ where: { id: args.opportunityId, clientId: args.clientId } });
  if (!o) throw notFound('Opportunity not found');
  const existing = await tx.enrollment.findUnique({ where: { smeUserId_opportunityId: { smeUserId: args.smeUserId, opportunityId: o.id } }, include: { opportunityVersion: true } });
  if (existing) {
    await audit({ entityType: 'Enrollment', entityId: existing.id, action: 'enrollment.resumed', after: { status: existing.status } });
    return { id: existing.id, status: existing.status, opportunityId: o.id, version: existing.opportunityVersion.version };
  }
  if (o.status !== 'PUBLISHED') throw new AppError(409, 'OPPORTUNITY_CLOSED', 'This opportunity is not accepting new applications.');
  const v = (await latestVersion(tx, o.id))!;
  const e = await tx.enrollment.create({ data: { clientId: o.clientId, smeUserId: args.smeUserId, opportunityId: o.id, opportunityVersionId: v.id } });
  await ensureConversation(tx, e.id, args.smeUserId);

  // Attribute the application to the campaign that brought the candidate, if it belongs to this project.
  if (args.campaignId) {
    const c = await tx.campaign.findFirst({ where: { id: args.campaignId, projectId: o.projectId } });
    if (c) {
      const candidate = await tx.candidate.findUnique({ where: { smeUserId: args.smeUserId } });
      await tx.application.create({ data: { clientId: o.clientId, campaignId: c.id, enrollmentId: e.id, candidateId: candidate?.id ?? null, source: c.channel } });
    }
  }
  await audit({ entityType: 'Enrollment', entityId: e.id, action: 'enrollment.started', after: { status: 'DRAFT', opportunityVersion: v.version, campaignId: args.campaignId ?? null } });
  return { id: e.id, status: e.status, opportunityId: o.id, version: v.version };
}
