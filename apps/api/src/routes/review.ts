import { ClaimReviewRequest, experienceDurations, OpportunityCriteria, ProfileData, SelectionDecisionRequest, TERMS_KEYS } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentTerms } from '../candidate/onboarding-service';
import { recordDecision, reviewableEnrollment, runAssessment } from '../candidate/selection-service';
import type { ObjectStorage } from '../candidate/storage';
import type { SuitabilityEvaluator } from '../candidate/suitability';
import type { Db } from '../db';
import { sha256 } from '../lib/crypto';
import { AppError, badRequest, notFound } from '../lib/errors';
import { writeAudit } from '../platform/audit';
import { runCommand } from '../platform/command';
import { loadProject } from './projects';

const IdParams = z.object({ id: z.string().uuid() });
const REVIEW = ['REVIEWER', 'ADMIN'] as const;

/** FLOW2 8.2: lightweight human review and selection; reviewers restricted to their assigned pools. */
export const reviewRoutes: FastifyPluginAsyncZod<{ db: Db; evaluator: SuitabilityEvaluator; storage: ObjectStorage }> = async (app, { db, evaluator, storage }) => {
  // ── Project reviewers (PM owner / Admin) ──
  app.get('/projects/:id/reviewers', { config: { access: ['PM', 'ADMIN'] }, schema: { tags: ['review'], params: IdParams } }, async (req) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    const list = await db.projectReviewer.findMany({ where: { projectId: p.id }, include: { user: true } });
    const candidates = await db.user.findMany({ where: { clientId: p.clientId, roles: { has: 'REVIEWER' }, status: 'ACTIVE' }, orderBy: { name: 'asc' } });
    return {
      items: list.map((r) => ({ userId: r.userId, name: r.user.name, email: r.user.email })),
      available: candidates.filter((u) => !list.some((r) => r.userId === u.id)).map((u) => ({ userId: u.id, name: u.name, email: u.email })),
    };
  });
  app.post(
    '/projects/:id/reviewers',
    { config: { access: ['PM', 'ADMIN'] }, schema: { tags: ['review'], params: IdParams, body: z.object({ userId: z.string().uuid() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        const u = await tx.user.findFirst({ where: { id: req.body.userId, clientId: p.clientId, roles: { has: 'REVIEWER' }, status: 'ACTIVE' } });
        if (!u) throw badRequest('Choose an active Reviewer');
        await tx.projectReviewer.upsert({ where: { projectId_userId: { projectId: p.id, userId: u.id } }, create: { clientId: p.clientId, projectId: p.id, userId: u.id, assignedById: actor.userId }, update: {} });
        await audit({ entityType: 'Project', entityId: p.id, action: 'project.reviewer_assigned', after: { userId: u.id } });
        return { status: 200, body: { userId: u.id } };
      });
      return reply;
    },
  );
  app.delete(
    '/projects/:id/reviewers/:userId',
    { config: { access: ['PM', 'ADMIN'] }, schema: { tags: ['review'], params: IdParams.extend({ userId: z.string().uuid() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        const { count } = await tx.projectReviewer.deleteMany({ where: { projectId: p.id, userId: req.params.userId } });
        if (!count) throw notFound('Reviewer not assigned');
        await audit({ entityType: 'Project', entityId: p.id, action: 'project.reviewer_removed', after: { userId: req.params.userId } });
        return { status: 200, body: { removed: true } };
      });
      return reply;
    },
  );

  // ── Queue and detail ──
  app.get(
    '/review/enrollments',
    { config: { access: REVIEW }, schema: { tags: ['review'], querystring: z.object({ status: z.enum(['SUBMITTED', 'REVIEW_PENDING', 'REVIEW_REQUESTED', 'NEEDS_INFORMATION', 'SELECTED', 'NOT_SELECTED']).optional() }) } },
    async (req) => {
      const actor = req.actor!;
      const projectIds = actor.roles.includes('ADMIN') ? undefined : (await db.projectReviewer.findMany({ where: { userId: actor.userId } })).map((r) => r.projectId);
      const conflicts = new Set((await db.conflictDeclaration.findMany({ where: { reviewerId: actor.userId, resolvedAt: null } })).map((c) => c.smeUserId));
      const rows = await db.enrollment.findMany({
        where: {
          clientId: actor.clientId,
          status: req.query.status ?? { in: ['SUBMITTED', 'REVIEW_PENDING', 'REVIEW_REQUESTED'] },
          ...(projectIds ? { opportunity: { projectId: { in: projectIds } } } : {}),
        },
        include: { smeUser: true, opportunityVersion: true, opportunity: { include: { project: true } }, assessments: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { submittedAt: 'asc' },
      });
      return {
        items: rows
          .filter((e) => !conflicts.has(e.smeUserId))
          .map((e) => ({
            id: e.id,
            candidateName: e.smeUser.displayName,
            projectName: e.opportunity.project.name,
            title: (e.opportunityVersion.brief as { title?: string }).title ?? '',
            status: e.status,
            submittedAt: e.submittedAt?.toISOString() ?? null,
            recommendation: e.assessments[0]?.status ?? null,
          })),
      };
    },
  );

  app.get('/review/enrollments/:id', { config: { access: REVIEW }, schema: { tags: ['review'], params: IdParams } }, async (req) => {
    const e = await reviewableEnrollment(db, req.actor!, req.params.id);
    const criteria = OpportunityCriteria.parse(e.opportunityVersion.criteria);
    const version = e.profileVersionId ? await db.profileVersion.findUnique({ where: { id: e.profileVersionId }, include: { claims: { include: { evidence: true } } } }) : null;
    const profile = ProfileData.parse(version?.data ?? {});
    const assessment = await db.suitabilityAssessment.findFirst({ where: { enrollmentId: e.id }, orderBy: { createdAt: 'desc' } });
    const decisions = await db.selectionDecision.findMany({ where: { enrollmentId: e.id }, orderBy: { decidedAt: 'asc' } });
    const evidence = await db.evidenceArtifact.findMany({ where: { smeUserId: e.smeUserId, deletionRequestedAt: null } });
    return {
      id: e.id,
      status: e.status,
      candidate: { name: e.smeUser.displayName, identityStatus: e.smeUser.identityStatus },
      opportunity: { title: (e.opportunityVersion.brief as { title?: string }).title, version: e.opportunityVersion.version, projectId: e.opportunity.projectId, brief: e.opportunityVersion.brief },
      criteria,
      profile,
      durations: experienceDurations(profile),
      profileVersion: version ? { id: version.id, version: version.version, contentHash: version.contentHash, submittedAt: version.submittedAt } : null,
      claims: (version?.claims ?? []).map((c) => ({ id: c.id, type: c.claimType, value: (c.value as { text?: string }).text ?? '', evidenceLevel: c.evidenceLevel, method: c.method, checkedAt: c.checkedAt, evidenceIds: c.evidence.map((x) => x.id) })),
      evidence: evidence.map((x) => ({ id: x.id, filename: x.filename, mimeType: x.mimeType, sizeBytes: x.sizeBytes, scanStatus: x.scanStatus })),
      assessment: assessment ? { id: assessment.id, status: assessment.status, findings: assessment.findings, limitations: assessment.limitations, errorCode: assessment.errorCode, modelVersion: assessment.modelVersion, proposedScope: assessment.proposedScope } : null,
      decisions: decisions.map((d) => ({ outcome: d.outcome, reasons: d.reasons, decidedAt: d.decidedAt.toISOString(), reviewerId: d.reviewerId })),
      reviewRequestReason: e.reviewRequestReason,
    };
  });

  // Evidence opens only for authorised reviewers, only once scanned clean; every access is audited.
  app.get('/review/evidence/:id', { config: { access: REVIEW }, schema: { tags: ['review'], params: IdParams, querystring: z.object({ enrollmentId: z.string().uuid() }) } }, async (req, reply) => {
    const e = await reviewableEnrollment(db, req.actor!, req.query.enrollmentId);
    const x = await db.evidenceArtifact.findFirst({ where: { id: req.params.id, smeUserId: e.smeUserId } });
    if (!x) throw notFound('File not found');
    if (x.scanStatus !== 'CLEAN') throw new AppError(409, 'NOT_SCANNED', 'This file has not passed the malware scan.');
    const data = await storage.get(x.storageKey);
    await db.$transaction((tx) => writeAudit(tx, { clientId: e.clientId, actorType: 'USER', actorId: req.actor!.userId, requestId: String(req.id) }, { entityType: 'EvidenceArtifact', entityId: x.id, action: 'evidence.accessed', after: { enrollmentId: e.id } }));
    return reply.header('content-type', x.mimeType).header('content-disposition', `attachment; filename="${x.filename.replace(/"/g, '')}"`).header('cache-control', 'no-store').send(data);
  });

  app.post(
    '/review/claims/:id/verify',
    { config: { access: REVIEW }, schema: { tags: ['review'], params: IdParams, body: ClaimReviewRequest.extend({ enrollmentId: z.string().uuid() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const e = await reviewableEnrollment(tx, actor, req.body.enrollmentId);
        const c = await tx.credentialClaim.findFirst({ where: { id: req.params.id, profileVersionId: e.profileVersionId ?? undefined } });
        if (!c) throw notFound('Claim not found');
        await tx.credentialClaim.update({ where: { id: c.id }, data: { evidenceLevel: req.body.evidenceLevel, method: req.body.method, checkerId: actor.userId, checkedAt: new Date(), disputed: req.body.evidenceLevel === 'CONTRADICTED' } });
        await audit({ entityType: 'CredentialClaim', entityId: c.id, action: 'claim.reviewed', before: { evidenceLevel: c.evidenceLevel }, after: { evidenceLevel: req.body.evidenceLevel, method: req.body.method, notes: req.body.notes ?? null } });
        return { status: 200, body: { id: c.id, evidenceLevel: req.body.evidenceLevel } };
      });
      return reply;
    },
  );

  app.post('/review/enrollments/:id/decision', { config: { access: REVIEW }, schema: { tags: ['review'], params: IdParams, body: SelectionDecisionRequest } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
      const d = await recordDecision(tx, actor, req.params.id, req.body, audit);
      if (req.body.outcome === 'SELECTED') {
        // Onboarding comes next; the candidate becomes assignable (candidate.approved) when it completes.
        await emit({ name: 'enrollment.decided', aggregateType: 'Enrollment', aggregateId: req.params.id, payload: { enrollmentId: req.params.id, outcome: d.outcome } });
      }
      return { status: 200, body: { decisionId: d.id, outcome: d.outcome } };
    });
    return reply;
  });

  // A review request reopens the case without erasing the earlier decision (section 10).
  app.post(
    '/review/enrollments/:id/reopen',
    { config: { access: REVIEW }, schema: { tags: ['review'], params: IdParams, body: z.object({ to: z.enum(['REVIEW_PENDING', 'NEEDS_INFORMATION']), informationRequest: z.string().trim().max(1000).optional() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const e = await reviewableEnrollment(tx, actor, req.params.id);
        if (e.status !== 'REVIEW_REQUESTED') throw new AppError(409, 'NOT_REQUESTED', 'Only a requested review can be reopened.');
        if (req.body.to === 'NEEDS_INFORMATION' && !req.body.informationRequest) throw badRequest('Say what information is needed');
        await tx.enrollment.update({ where: { id: e.id }, data: { status: req.body.to, informationRequest: req.body.informationRequest ?? null, revision: { increment: 1 } } });
        await audit({ entityType: 'Enrollment', entityId: e.id, action: 'enrollment.reopened', before: { status: e.status }, after: { status: req.body.to } });
        return { status: 200, body: { status: req.body.to } };
      });
      return reply;
    },
  );

  // A failed assessment is recoverable: retry, or review without a recommendation.
  app.post(
    '/review/enrollments/:id/assessment/retry',
    { config: { access: REVIEW }, schema: { tags: ['review'], params: IdParams, body: z.object({ withoutRecommendation: z.boolean().default(false) }) } },
    async (req) => {
      const e = await reviewableEnrollment(db, req.actor!, req.params.id);
      if (e.status !== 'SUBMITTED') throw new AppError(409, 'NOT_SUBMITTED', 'Only a submitted application awaiting assessment can be retried.');
      const a = await db.suitabilityAssessment.findFirst({ where: { enrollmentId: e.id, profileVersionId: e.profileVersionId!, status: 'ERROR' }, orderBy: { createdAt: 'desc' } });
      if (!a) throw new AppError(409, 'NO_FAILED_ASSESSMENT', 'There is no failed assessment to retry.');
      if (req.body.withoutRecommendation) {
        await db.$transaction(async (tx) => {
          await tx.enrollment.update({ where: { id: e.id }, data: { status: 'REVIEW_PENDING', revision: { increment: 1 } } });
          await writeAudit(tx, { clientId: e.clientId, actorType: 'USER', actorId: req.actor!.userId, requestId: String(req.id) }, { entityType: 'Enrollment', entityId: e.id, action: 'enrollment.review_without_recommendation', before: { status: 'SUBMITTED' }, after: { status: 'REVIEW_PENDING' } });
        });
        return { result: 'REVIEW_PENDING' };
      }
      return { result: await runAssessment(db, evaluator, a.id) };
    },
  );

  // Reviewers declare conflicts with candidates; they then cannot see or decide those applications.
  app.post(
    '/review/conflicts',
    { config: { access: REVIEW }, schema: { tags: ['review'], body: z.object({ enrollmentId: z.string().uuid(), details: z.string().trim().min(1).max(1000) }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const e = await tx.enrollment.findFirst({ where: { id: req.body.enrollmentId, clientId: actor.clientId } });
        if (!e) throw notFound('Application not found');
        const c = await tx.conflictDeclaration.create({ data: { clientId: e.clientId, smeUserId: e.smeUserId, enrollmentId: e.id, reviewerId: actor.userId, employerDescription: req.body.details.slice(0, 500), details: req.body.details } });
        await audit({ entityType: 'ConflictDeclaration', entityId: c.id, action: 'conflict.declared_by_reviewer', after: { enrollmentId: e.id } });
        return { status: 201, body: { id: c.id } };
      });
      return reply;
    },
  );

  // Candidate-declared conflicts block assignment until an authorised person resolves them.
  app.get('/review/conflicts', { config: { access: REVIEW }, schema: { tags: ['review'] } }, async (req) => {
    const rows = await db.conflictDeclaration.findMany({ where: { clientId: req.actor!.clientId, reviewerId: null, resolvedAt: null }, include: { smeUser: true } });
    return { items: rows.map((c) => ({ id: c.id, candidateName: c.smeUser.displayName, enrollmentId: c.enrollmentId, details: c.details, declaredAt: c.declaredAt.toISOString() })) };
  });
  app.post(
    '/review/conflicts/:id/resolve',
    { config: { access: REVIEW }, schema: { tags: ['review'], params: IdParams, body: z.object({ resolution: z.string().trim().min(1).max(1000) }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const c = await tx.conflictDeclaration.findFirst({ where: { id: req.params.id, clientId: actor.clientId, resolvedAt: null, reviewerId: null } });
        if (!c) throw notFound('Conflict not found');
        if (c.enrollmentId) await reviewableEnrollment(tx, actor, c.enrollmentId);
        await tx.conflictDeclaration.update({ where: { id: c.id }, data: { resolvedAt: new Date() } });
        await audit({ entityType: 'ConflictDeclaration', entityId: c.id, action: 'conflict.resolved', after: { resolution: req.body.resolution } });
        return { status: 200, body: { resolved: true } };
      });
      return reply;
    },
  );

  // ── Terms (Admin) ──
  app.get('/terms', { config: { access: ['ADMIN'] }, schema: { tags: ['terms'] } }, async (req) => {
    const current = await currentTerms(db, req.actor!.clientId);
    return { items: TERMS_KEYS.map((key, i) => ({ key, current: current[i] ? { id: current[i]!.id, title: current[i]!.title, version: current[i]!.version, placeholder: current[i]!.placeholder, body: current[i]!.body } : null })) };
  });
  app.post(
    '/terms',
    { config: { access: ['ADMIN'] }, schema: { tags: ['terms'], body: z.object({ key: z.enum(TERMS_KEYS), title: z.string().trim().min(1).max(200), body: z.string().trim().min(20).max(100_000) }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const last = await tx.termsDocument.findFirst({ where: { clientId: actor.clientId, key: req.body.key }, orderBy: { version: 'desc' } });
        const doc = await tx.termsDocument.create({
          data: { clientId: actor.clientId, key: req.body.key, version: (last?.version ?? 0) + 1, title: req.body.title, body: req.body.body, sha256: sha256(req.body.body), placeholder: false, publishedById: actor.userId },
        });
        await audit({ entityType: 'TermsDocument', entityId: doc.id, action: 'terms.published', after: { key: doc.key, version: doc.version, sha256: doc.sha256 } });
        return { status: 201, body: { id: doc.id, key: doc.key, version: doc.version } };
      });
      return reply;
    },
  );
};
