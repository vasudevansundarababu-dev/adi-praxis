import '@fastify/multipart';
import type { Prisma } from '@prisma/client';
import { CorrectionsRequest, identityEligible, nextQuestion, ProfileData, readiness, SendMessageRequest, SubmitProfileRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MAX_DOCUMENT_BYTES } from '../candidate/document-text';
import type { ProfileAssistant } from '../candidate/profile-assistant';
import {
  allowedFieldKeys,
  applyCorrections,
  applyQuickReply,
  conversationState,
  draftProfile,
  EDITABLE_ENROLLMENT,
  ensureConversation,
  ownEnrollment,
  policyFor,
  processCandidateTurn,
  profileHash,
} from '../candidate/profile-service';
import { detectSensitive } from '../candidate/sensitive';
import type { MalwareScanner, ObjectStorage } from '../candidate/storage';
import type { Db } from '../db';
import { sha256 } from '../lib/crypto';
import { AppError, badRequest, notFound } from '../lib/errors';
import { writeAudit } from '../platform/audit';
import { runCandidateCommand } from '../platform/command';

export interface ProfileDeps {
  db: Db;
  assistant: ProfileAssistant;
  storage: ObjectStorage;
  scanner: MalwareScanner;
}

const IdParams = z.object({ id: z.string().uuid() });
const QUICK_LABELS = { DONT_KNOW: 'I don’t know', CANNOT_DISCLOSE: 'I can’t disclose that', SKIP: 'Skip this question' } as const;
const EVIDENCE_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
} as const;

/** Evidence files are identified by signature, not by name or declared type. */
function sniffEvidence(buf: Buffer): keyof typeof EVIDENCE_TYPES | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from('word/'))) return 'docx';
  return null;
}

const notEditable = (status: string) => new AppError(409, 'NOT_EDITABLE', `This application can’t be changed now (it is ${status.toLowerCase().replace(/_/g, ' ')}).`);
const stale = (revision: number) => new AppError(409, 'STALE_REVISION', 'Your profile changed in another tab or window. Reload to continue.', { revision });

/** FLOW2-SME C04 (conversational profile) and C05 (review, evidence, explicit submit). */
export const profileRoutes: FastifyPluginAsyncZod<ProfileDeps> = async (app, deps) => {
  const { db, assistant, storage, scanner } = deps;

  app.post('/me/enrollments/:id/conversation/start', { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams } }, async (req) => {
    const me = req.candidate!;
    await db.$transaction((tx) => ensureConversation(tx, req.params.id, me.smeUserId));
    return conversationState(db, req.params.id, me.smeUserId);
  });

  app.get('/me/enrollments/:id/conversation', { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams } }, async (req) =>
    conversationState(db, req.params.id, req.candidate!.smeUserId),
  );

  app.post(
    '/me/enrollments/:id/conversation/messages',
    { config: { access: 'candidate', rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['candidate'], params: IdParams, body: SendMessageRequest } },
    async (req, reply) => {
      const me = req.candidate!;
      const e = await ownEnrollment(db, req.params.id, me.smeUserId);
      if (!(EDITABLE_ENROLLMENT as readonly string[]).includes(e.status)) throw notEditable(e.status);
      if (!e.conversation) throw new AppError(409, 'NOT_STARTED', 'Start the conversation first.');
      const session = e.conversation;

      // Retries of the same message are deduplicated by the client message id (CF-15).
      const dup = await db.conversationTurn.findUnique({ where: { sessionId_clientMessageId: { sessionId: session.id, clientMessageId: req.body.clientMessageId } } });
      if (dup) {
        if (dup.extractionStatus === 'PENDING' || dup.extractionStatus === 'FAILED') await processCandidateTurn({ db, assistant }, e.id, me.smeUserId, dup.id);
        reply.header('idempotent-replayed', 'true');
        return conversationState(db, e.id, me.smeUserId);
      }

      const { policy } = policyFor(e.opportunityVersion);
      const draft = (await draftProfile(db, e.id))!;
      const current = nextQuestion(policy, ProfileData.parse(draft.data));
      if (req.body.questionId && current?.id !== req.body.questionId) throw stale(session.revision);
      const q = current;
      if (req.body.quickReply === 'SKIP' && q?.required) throw badRequest('This question is required. You can answer “I don’t know” or “I can’t disclose” instead.');

      const sensitive = req.body.content ? detectSensitive(req.body.content, { allowEmails: e.smeUser.contactEmail ? [e.smeUser.contactEmail] : [] }) : null;
      const turnId = await db.$transaction(async (tx) => {
        // Two tabs cannot silently overwrite each other: the revision must match.
        const { count } = await tx.conversationSession.updateMany({ where: { id: session.id, revision: req.body.expectedRevision }, data: { revision: { increment: 1 } } });
        if (count === 0) throw stale(session.revision);
        const seq = ((await tx.conversationTurn.findFirst({ where: { sessionId: session.id }, orderBy: { sequence: 'desc' } }))?.sequence ?? 0) + 1;
        const content = req.body.quickReply ? QUICK_LABELS[req.body.quickReply] : sensitive!.flagged ? sensitive!.redacted : req.body.content!;
        const turn = await tx.conversationTurn.create({
          data: {
            clientId: e.clientId,
            sessionId: session.id,
            clientMessageId: req.body.clientMessageId,
            sequence: seq,
            speaker: 'CANDIDATE',
            // A flagged message is stored redacted only; the original is never kept (CF-13).
            content,
            redacted: !!sensitive?.flagged,
            sensitiveKinds: sensitive?.kinds ?? [],
            questionId: q?.id ?? null,
            acknowledgedAt: new Date(),
            extractionStatus: req.body.quickReply ? 'NONE' : sensitive!.flagged ? 'SKIPPED' : 'PENDING',
            policyVersion: String(e.opportunityVersion.version),
          },
        });
        await writeAudit(tx, { clientId: e.clientId, actorType: 'CANDIDATE', actorId: me.smeUserId, requestId: String(req.id) }, {
          entityType: 'ConversationSession',
          entityId: session.id,
          action: req.body.quickReply ? 'conversation.quick_reply' : 'conversation.message_received',
          after: { sequence: seq, questionId: q?.id ?? null, quickReply: req.body.quickReply ?? null, redacted: !!sensitive?.flagged, kinds: sensitive?.kinds ?? [] },
        });

        let nextSeq = seq;
        const say = async (text: string, questionId: string | null) =>
          tx.conversationTurn.create({
            data: { clientId: e.clientId, sessionId: session.id, clientMessageId: `srv-${randomUUID()}`, sequence: ++nextSeq, speaker: 'ASSISTANT', content: text, questionId, acknowledgedAt: new Date() },
          });

        if (sensitive?.flagged && q) {
          await say(`For your protection I’ve removed part of that message (${sensitive.kinds.map((k) => k.toLowerCase().replace(/_/g, ' ')).join(', ')}) and haven’t used it. Please describe the work in generic or synthetic terms, without names, account or ID numbers.\n\n${q.text}`, q.id);
        }
        if (req.body.quickReply && q) {
          const updated = applyQuickReply(ProfileData.parse(draft.data), q, req.body.quickReply, turn.id);
          await tx.profileVersion.update({ where: { id: draft.id }, data: { data: updated as unknown as Prisma.InputJsonValue } });
          const n = nextQuestion(policy, updated);
          await say(n ? (n.options.length ? `${n.text}\n(For example: ${n.options.join(', ')}.)` : n.text) : 'That covers everything this opportunity needs. Please review your profile and submit when you’re ready. Nothing is submitted until you choose to.', n?.id ?? null);
          if (!n) await tx.conversationSession.update({ where: { id: session.id }, data: { status: 'READY_TO_CONFIRM' } });
        }
        return turn.id;
      });

      if (!req.body.quickReply && !sensitive?.flagged) await processCandidateTurn({ db, assistant }, e.id, me.smeUserId, turnId);
      return conversationState(db, e.id, me.smeUserId);
    },
  );

  app.post(
    '/me/enrollments/:id/conversation/messages/:clientMessageId/retry',
    { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams.extend({ clientMessageId: z.string().uuid() }) } },
    async (req) => {
      const me = req.candidate!;
      const e = await ownEnrollment(db, req.params.id, me.smeUserId);
      if (!e.conversation) throw notFound('Conversation not found');
      const t = await db.conversationTurn.findUnique({ where: { sessionId_clientMessageId: { sessionId: e.conversation.id, clientMessageId: req.params.clientMessageId } } });
      if (!t) throw notFound('Message not found');
      await processCandidateTurn({ db, assistant }, e.id, me.smeUserId, t.id);
      return conversationState(db, e.id, me.smeUserId);
    },
  );

  // Confirm / edit / mark unknown from the profile panel, the review page and the accessible form (C04, C05, CF-30).
  app.post('/me/profile/corrections', { config: { access: 'candidate' }, schema: { tags: ['candidate'], body: CorrectionsRequest } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const e = await ownEnrollment(tx, req.body.enrollmentId, actor.smeUserId);
      if (!(EDITABLE_ENROLLMENT as readonly string[]).includes(e.status)) throw notEditable(e.status);
      await ensureConversation(tx, e.id, actor.smeUserId);
      const session = (await tx.conversationSession.findUniqueOrThrow({ where: { enrollmentId: e.id } }));
      const { count } = await tx.conversationSession.updateMany({ where: { id: session.id, revision: req.body.expectedRevision }, data: { revision: { increment: 1 } } });
      if (count === 0) throw stale(session.revision);
      const { policy } = policyFor(e.opportunityVersion);
      const draft = (await draftProfile(tx, e.id))!;
      const updated = applyCorrections(ProfileData.parse(draft.data), req.body, allowedFieldKeys(policy));
      await tx.profileVersion.update({ where: { id: draft.id }, data: { data: updated as unknown as Prisma.InputJsonValue } });
      await tx.conversationSession.update({ where: { id: session.id }, data: { status: nextQuestion(policy, updated) ? 'IN_PROGRESS' : 'READY_TO_CONFIRM' } });
      await audit({
        entityType: 'ProfileVersion',
        entityId: draft.id,
        action: 'profile.corrected',
        after: { fields: req.body.fields.map((f) => `${f.fieldKey}:${f.action}`), roles: req.body.roles.map((r) => r.action), claims: req.body.claims.map((c) => c.action) },
      });
      return { status: 200, body: await conversationState(tx, e.id, actor.smeUserId) };
    });
    return reply;
  });

  // ── Evidence (private; least sensitive sufficient evidence; FLOW2 7.2) ──

  app.post('/me/evidence', { config: { access: 'candidate', rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['candidate'] } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1, fields: 3 } });
    if (!file) throw badRequest('Attach a file');
    const permission = (file.fields.permission as { value?: string } | undefined)?.value;
    if (permission !== 'true') throw badRequest('Confirm you have permission to share this file for qualification review');
    const buf = await file.toBuffer();
    if (file.file.truncated || buf.length > MAX_DOCUMENT_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
    const kind = sniffEvidence(buf);
    if (!kind) throw new AppError(415, 'UNSUPPORTED_FILE', 'Upload a PDF, Word (.docx), PNG or JPG file.');
    const scan = await scanner.scan(buf);
    if (scan === 'INFECTED') throw new AppError(422, 'FILE_REJECTED', 'This file could not be accepted.');
    const me = req.candidate!;
    const storageKey = `evidence/${me.smeUserId}/${randomUUID()}.${kind}`;
    await storage.put(storageKey, buf, EVIDENCE_TYPES[kind]);
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const x = await tx.evidenceArtifact.create({
        data: {
          clientId: actor.clientId,
          smeUserId: actor.smeUserId,
          storageKey,
          filename: file.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || `evidence.${kind}`,
          sha256: sha256(buf.toString('binary')),
          mimeType: EVIDENCE_TYPES[kind],
          sizeBytes: buf.length,
          permissionGranted: true,
          scanStatus: scan,
          retentionCategory: 'qualification-evidence',
        },
      });
      await audit({ entityType: 'EvidenceArtifact', entityId: x.id, action: 'evidence.uploaded', after: { mimeType: x.mimeType, sizeBytes: x.sizeBytes, scanStatus: scan } });
      return { status: 201, body: { id: x.id, filename: x.filename, mimeType: x.mimeType, sizeBytes: x.sizeBytes, scanStatus: x.scanStatus } };
    });
    return reply;
  });

  app.delete('/me/evidence/:id', { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const x = await tx.evidenceArtifact.findFirst({ where: { id: req.params.id, smeUserId: actor.smeUserId, deletionRequestedAt: null }, include: { claims: { include: { profileVersion: true } } } });
      if (!x) throw notFound('File not found');
      // Evidence attached to a submitted profile is retained per policy; removal is recorded as a request.
      const retained = x.claims.some((c) => c.profileVersion.submittedAt);
      if (retained) await tx.evidenceArtifact.update({ where: { id: x.id }, data: { deletionRequestedAt: new Date() } });
      else {
        await tx.evidenceArtifact.delete({ where: { id: x.id } });
        await storage.delete(x.storageKey);
      }
      await audit({ entityType: 'EvidenceArtifact', entityId: x.id, action: retained ? 'evidence.deletion_requested' : 'evidence.deleted', after: { retained } });
      return { status: 200, body: { deleted: !retained, retainedUnderPolicy: retained } };
    });
    return reply;
  });

  // ── Explicit submit (C05, CF-18) ──

  app.post(
    '/me/enrollments/:id/submit',
    { config: { access: 'candidate' }, schema: { tags: ['candidate'], params: IdParams, body: SubmitProfileRequest } },
    async (req, reply) => {
      await runCandidateCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
        const e = await ownEnrollment(tx, req.params.id, actor.smeUserId);
        if (!(EDITABLE_ENROLLMENT as readonly string[]).includes(e.status)) throw new AppError(409, 'ALREADY_SUBMITTED', 'This profile has already been submitted.');
        if (!identityEligible(e.smeUser.identityStatus)) {
          throw new AppError(409, 'IDENTITY_REQUIRED', 'Finish identity verification before submitting. Your profile is saved.');
        }
        const session = await tx.conversationSession.findUnique({ where: { enrollmentId: e.id } });
        if (!session) throw new AppError(409, 'NOT_STARTED', 'Start your profile first.');
        const { count } = await tx.conversationSession.updateMany({ where: { id: session.id, revision: req.body.expectedRevision }, data: { revision: { increment: 1 }, status: 'SUBMITTED' } });
        if (count === 0) throw stale(session.revision);

        const { policy, criteria } = policyFor(e.opportunityVersion);
        const draft = (await draftProfile(tx, e.id))!;
        const profile = ProfileData.parse(draft.data);
        const ready = readiness(policy, profile, criteria);
        if (!ready.canSubmit) {
          throw new AppError(422, 'PROFILE_INCOMPLETE', 'Some items need your attention before you can submit.', ready);
        }

        // Freeze: the profile version becomes immutable, with structured episodes and claims (FLOW2 section 11).
        const now = new Date();
        await tx.profileVersion.update({ where: { id: draft.id }, data: { submittedAt: now, contentHash: profileHash(profile) } });
        for (const r of profile.roles.filter((x) => x.status === 'CONFIRMED')) {
          await tx.experienceEpisode.create({
            data: {
              clientId: e.clientId,
              profileVersionId: draft.id,
              startMonth: r.start,
              endMonth: r.end,
              precision: r.approximate ? 'APPROXIMATE' : 'MONTH',
              specialty: r.specialtyRelevant ? 'relevant' : null,
              role: r.title,
              responsibility: r.responsibility,
              employerScope: r.employerType || null,
              sourceTurnIds: r.sources,
            },
          });
        }
        for (const c of profile.claims.filter((x) => x.status === 'CONFIRMED')) {
          const owned = await tx.evidenceArtifact.findMany({ where: { id: { in: c.evidenceIds }, smeUserId: actor.smeUserId, deletionRequestedAt: null } });
          await tx.credentialClaim.create({
            data: {
              clientId: e.clientId,
              profileVersionId: draft.id,
              claimType: c.type,
              value: { text: c.value },
              issuer: c.issuer,
              expiresAt: c.expiresAt ? new Date(`${c.expiresAt}-01T00:00:00Z`) : null,
              evidenceLevel: 'SELF_REPORTED',
              evidence: { connect: owned.map((o) => ({ id: o.id })) },
            },
          });
        }
        await tx.enrollment.update({ where: { id: e.id }, data: { status: 'SUBMITTED', profileVersionId: draft.id, submittedAt: now, revision: { increment: 1 } } });
        // Exactly one assessment job per submission; it only recommends. A human decides (M4c).
        const assessment = await tx.suitabilityAssessment.create({
          data: { clientId: e.clientId, enrollmentId: e.id, profileVersionId: draft.id, opportunityVersionId: e.opportunityVersionId, status: 'NOT_RUN' },
        });
        await tx.consent.create({ data: { clientId: e.clientId, smeUserId: actor.smeUserId, purpose: 'qualification_review', version: 'v1' } });
        if (req.body.futureOpportunities) await tx.consent.create({ data: { clientId: e.clientId, smeUserId: actor.smeUserId, purpose: 'future_opportunities', version: 'v1' } });
        await emit({ name: 'enrollment.submitted', aggregateType: 'Enrollment', aggregateId: e.id, payload: { enrollmentId: e.id, assessmentId: assessment.id, profileVersionId: draft.id } });
        await audit({
          entityType: 'Enrollment',
          entityId: e.id,
          action: 'enrollment.submitted',
          before: { status: e.status },
          after: { status: 'SUBMITTED', profileVersionId: draft.id, contentHash: profileHash(profile), opportunityVersion: e.opportunityVersion.version, requiredGaps: ready.requiredGaps.length },
        });
        return { status: 200, body: await conversationState(tx, e.id, actor.smeUserId) };
      });
      return reply;
    },
  );
};
