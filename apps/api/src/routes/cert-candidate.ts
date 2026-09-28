import '@fastify/multipart';
import type { Prisma } from '@prisma/client';
import { TIER_LABELS } from '@praxis/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ObjectStorage } from '../candidate/storage';
import { sniff } from '../candidate/document-text';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError, badRequest, notFound } from '../lib/errors';
import type { SecretBox } from '../lib/secrets';
import { runCandidateCommand } from '../platform/command';
import { attemptView, checkCanStart, completeModule, confirmGrade, courseView, ensureCertifications, ensureForm, finalizeTx, logIntegrity, ownCertification, saveAnswers, startTest, submitAttempt, submitLicence } from '../cert/attempts';
import type { CurriculumGenerator } from '../cert/generator';
import type { ItemDeps } from '../cert/items';
import { sectionsOf } from '../cert/pipeline';
import type { SelfieCheck } from '../cert/selfie';
import type { EmbeddingProvider } from '../tasks/embeddings';

const IdParams = z.object({ id: z.string().uuid() });
const MAX_LICENCE_BYTES = 10 * 1024 * 1024;
/** Limits count per candidate session, not per IP: candidates in one office share an address. */
const perCandidate = (max: number) => ({ max, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => req.cookies?.praxis_candidate ?? req.ip });

/** A candidate sees pass or fail and a band per section, never items, answers or keys after submission. */
const band = (pct: number) => (pct >= 85 ? 'Strong' : pct >= 70 ? 'Meets' : pct >= 50 ? 'Developing' : 'Below');

/**
 * M10b candidate routes (docs/SME-SUPPLY.md sections 7.4 and 7.6): course player, selfie re-check, test player and
 * result; licence upload for healthcare Experts; and, for certified Experts, confirming authoring-task grades and
 * reviewing Expert-tier item families.
 */
export const certCandidateRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; gen: CurriculumGenerator; box: SecretBox; embeddings: EmbeddingProvider; selfie: SelfieCheck; storage: ObjectStorage }> = async (app, deps) => {
  const { db, config, gen, box, selfie, storage } = deps;
  const itemDeps: ItemDeps = { db, gen, box, embeddings: deps.embeddings };

  // Opens the certifications a selected candidate needs (idempotent; each new one is audited), then lists them.
  app.get('/me/certifications', { config: { access: 'candidate' }, schema: { tags: ['cert'] } }, async (req) => {
    const smeUserId = req.candidate!.smeUserId;
    const all = await db.$transaction(async (tx) => {
      await ensureCertifications(tx, smeUserId);
      return tx.certification.findMany({ where: { smeUserId }, orderBy: { createdAt: 'asc' } });
    });
    return {
      items: all.map((c) => ({ id: c.id, domain: c.domain, tier: c.tier, tierLabel: TIER_LABELS[c.tier], state: c.state, attemptsUsed: c.attemptsUsed, retakeAvailableAt: c.retakeAvailableAt?.toISOString() ?? null, reviewReason: c.reviewReason, issuedAt: c.issuedAt?.toISOString() ?? null, expiresAt: c.expiresAt?.toISOString() ?? null, licenceRequired: c.licenceRequired, licenceStatus: c.licenceStatus })),
    };
  });

  app.get('/me/certifications/:id/course', { config: { access: 'candidate' }, schema: { tags: ['cert'], params: IdParams } }, async (req) => courseView(db, await ownCertification(db, req.params.id, req.candidate!.smeUserId)));

  app.post('/me/certifications/:id/modules/:moduleId/complete', { config: { access: 'candidate' }, schema: { tags: ['cert'], params: IdParams.extend({ moduleId: z.string().uuid() }), body: z.object({ answers: z.array(z.number().int().min(0)).max(20) }) } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const c = await ownCertification(tx, req.params.id, actor.smeUserId);
      return { status: 200, body: await completeModule(tx, c, req.params.moduleId, req.body.answers, audit) };
    });
    return reply;
  });

  // Selfie re-check before every attempt: returns the provider page to open; it sends the candidate back with ?selfie=.
  app.post('/me/certifications/:id/selfie', { config: { access: 'candidate', rateLimit: perCandidate(10) }, schema: { tags: ['cert'], params: IdParams } }, async (req, reply) => {
    const c = await ownCertification(db, req.params.id, req.candidate!.smeUserId);
    await checkCanStart(db, c);
    const s = await selfie.start({ smeUserId: c.smeUserId, returnUrl: `${config.CANDIDATE_APP_URL}/certifications/${c.id}/test` });
    await db.auditEvent.create({ data: { clientId: c.clientId, actorType: 'CANDIDATE', actorId: c.smeUserId, entityType: 'Certification', entityId: c.id, action: 'cert.selfie_started', after: { provider: selfie.mode, sessionRef: s.sessionRef } } });
    return reply.status(201).send(s);
  });

  app.post('/me/certifications/:id/test/start', { config: { access: 'candidate' }, schema: { tags: ['cert'], params: IdParams, body: z.object({ sessionRef: z.string().min(5).max(200) }) } }, async (req, reply) => {
    const c = await ownCertification(db, req.params.id, req.candidate!.smeUserId);
    // Outside the transaction: checks, and a form assembled now if the worker's buffer is empty.
    const { bp } = await checkCanStart(db, c);
    await ensureForm(itemDeps, bp.id, await sectionsOf(db, c.versionId));
    await runCandidateCommand(db, req, reply, async ({ tx, audit }) => {
      const a = await startTest(tx, c, req.body.sessionRef, selfie, audit);
      return { status: 201, body: await attemptView(tx, a) };
    });
    return reply;
  });

  app.get('/me/certifications/:id/test', { config: { access: 'candidate' }, schema: { tags: ['cert'], params: IdParams } }, async (req) => {
    const c = await ownCertification(db, req.params.id, req.candidate!.smeUserId);
    const a = await db.testAttempt.findFirst({ where: { certificationId: c.id }, orderBy: { attemptNo: 'desc' } });
    if (!a) return { certification: { id: c.id, state: c.state }, attempt: null };
    if (a.status === 'IN_PROGRESS') return { certification: { id: c.id, state: c.state }, attempt: await attemptView(db, a) };
    const sections = a.sectionScores as Record<string, number>;
    return {
      certification: { id: c.id, state: c.state, retakeAvailableAt: c.retakeAvailableAt?.toISOString() ?? null, attemptsUsed: c.attemptsUsed },
      attempt: { attemptId: a.id, attemptNo: a.attemptNo, status: a.status, submittedAt: a.submittedAt?.toISOString() ?? null, result: a.status === 'PASSED' ? 'PASS' : a.status === 'FAILED' ? 'FAIL' : 'PENDING_REVIEW', sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, band(v)])) },
    };
  });

  const ownAttempt = async (id: string, smeUserId: string) => {
    const a = await db.testAttempt.findFirst({ where: { id, smeUserId } });
    if (!a) throw notFound('Test not found');
    return a;
  };

  app.put('/me/test-attempts/:id/answers', { config: { access: 'candidate', rateLimit: perCandidate(240) }, schema: { tags: ['cert'], params: IdParams, body: z.object({ answers: z.record(z.string().uuid(), z.union([z.string().max(20_000), z.array(z.string().max(500)).max(30)])) }) } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const a = await ownAttempt(req.params.id, actor.smeUserId);
      const u = await saveAnswers(tx, a, req.body.answers);
      await audit({ entityType: 'TestAttempt', entityId: a.id, action: 'cert.answers_saved', after: { items: Object.keys(req.body.answers).length } });
      return { status: 200, body: { saved: Object.keys(u.answers as object).length } };
    });
    return reply;
  });

  // Integrity events: paste, focus changes, leaving the page. Logged, never used alone to fail anyone.
  app.post('/me/test-attempts/:id/integrity', { config: { access: 'candidate', rateLimit: perCandidate(120) }, schema: { tags: ['cert'], params: IdParams, body: z.object({ events: z.array(z.object({ type: z.enum(['PASTE', 'BLUR', 'FOCUS', 'VISIBILITY_HIDDEN', 'VISIBILITY_VISIBLE', 'FULLSCREEN_EXIT']), at: z.string().datetime(), detail: z.string().max(200).optional() })).min(1).max(50) }) } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const a = await ownAttempt(req.params.id, actor.smeUserId);
      await logIntegrity(tx, a, req.body.events);
      await audit({ entityType: 'TestAttempt', entityId: a.id, action: 'cert.integrity_logged', after: { events: req.body.events.map((e) => e.type) } });
      return { status: 200, body: { logged: req.body.events.length } };
    });
    return reply;
  });

  app.post('/me/test-attempts/:id/submit', { config: { access: 'candidate' }, schema: { tags: ['cert'], params: IdParams } }, async (req, reply) => {
    const a = await ownAttempt(req.params.id, req.candidate!.smeUserId);
    if (a.status !== 'IN_PROGRESS') throw new AppError(409, 'SUBMITTED', 'This test was already submitted.');
    const done = await submitAttempt(db, { box, gen }, a.id, { actorType: 'CANDIDATE', actorId: a.smeUserId });
    return reply.send({ attemptId: done.id, status: done.status, result: done.status === 'PASSED' ? 'PASS' : done.status === 'FAILED' ? 'FAIL' : 'PENDING_REVIEW' });
  });

  // Healthcare Experts: licence number, issuing body and certificate, checked by a Validator.
  app.post('/me/certifications/:id/licence', { config: { access: 'candidate' }, schema: { tags: ['cert'], params: IdParams } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_LICENCE_BYTES + 1, files: 1, fields: 4 } });
    if (!file) throw badRequest('Attach the licence certificate (PDF, PNG or JPG)');
    const field = (k: string) => ((file.fields[k] as { value?: string } | undefined)?.value ?? '').trim();
    const number = field('number');
    const issuingBody = field('issuingBody');
    if (!number || number.length > 60 || !issuingBody || issuingBody.length > 200) throw badRequest('Give the licence number and the issuing body.');
    const buf = await file.toBuffer();
    if (file.file.truncated || buf.length > MAX_LICENCE_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
    const isImage = buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg' : null;
    const kind = sniff(buf) === 'pdf' ? 'pdf' : isImage;
    if (!kind) throw new AppError(415, 'UNSUPPORTED_FILE', 'Upload a PDF, PNG or JPG file.');
    const c = await ownCertification(db, req.params.id, req.candidate!.smeUserId);
    const key = `licences/${c.id}/${randomUUID()}.${kind}`;
    await storage.put(key, buf, kind === 'pdf' ? 'application/pdf' : `image/${kind === 'jpg' ? 'jpeg' : 'png'}`);
    await runCandidateCommand(db, req, reply, async ({ tx, audit }) => {
      const u = await submitLicence(tx, c, { number, issuingBody, fileName: file.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 200), storageKey: key }, audit);
      return { status: 201, body: { id: u.id, licenceStatus: u.licenceStatus } };
    });
    return reply;
  });

  // ── Certified Experts: confirm authoring-task grades, review Expert-tier item families ──
  const expertDomains = async (smeUserId: string) => (await db.certification.findMany({ where: { smeUserId, tier: 'EXPERT', state: 'PASSED' } })).map((c) => c.domain);

  app.get('/me/assessments', { config: { access: 'candidate' }, schema: { tags: ['cert'] } }, async (req) => {
    const domains = await expertDomains(req.candidate!.smeUserId);
    if (!domains.length) return { items: [] };
    const attempts = await db.testAttempt.findMany({ where: { status: 'NEEDS_REVIEW', smeUserId: { not: req.candidate!.smeUserId }, certification: { domain: { in: domains }, tier: 'EXPERT' } }, include: { certification: true } });
    const out = [];
    for (const a of attempts) {
      for (const [itemId, g] of Object.entries(a.grading as Record<string, { written?: boolean; confirmations?: { by: string }[]; required?: number; recommendation?: unknown }>)) {
        if (!g.written || (g.confirmations ?? []).some((x) => x.by === req.candidate!.smeUserId) || (g.confirmations?.length ?? 0) >= (g.required ?? 1)) continue;
        const i = await db.itemInstance.findUniqueOrThrow({ where: { id: itemId }, include: { family: { select: { itemType: true } } } });
        if (i.family.itemType !== 'AUTHORING') continue;
        out.push({ attemptId: a.id, itemId, domain: a.certification.domain, stem: i.stem, rubric: (i.content as { rubric?: unknown }).rubric ?? [], answer: (a.answers as Record<string, unknown>)[itemId] ?? '', recommendation: g.recommendation });
      }
    }
    return { items: out };
  });

  app.post('/me/assessments/:id/grades', { config: { access: 'candidate' }, schema: { tags: ['cert'], params: IdParams, body: z.object({ itemId: z.string().uuid(), score: z.number().min(0).max(1) }) } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const r = await confirmGrade(tx, { attemptId: req.params.id, itemId: req.body.itemId, score: req.body.score, confirmer: { kind: 'EXPERT', smeUserId: actor.smeUserId } });
      await audit({ entityType: 'TestAttempt', entityId: req.params.id, action: 'cert.grade_confirmed', after: { itemId: req.body.itemId, score: req.body.score, by: 'EXPERT' } });
      await finalizeTx(tx, req.params.id);
      return { status: 200, body: r };
    });
    return reply;
  });

  app.get('/me/expert-reviews', { config: { access: 'candidate' }, schema: { tags: ['cert'] } }, async (req) => {
    const domains = await expertDomains(req.candidate!.smeUserId);
    if (!domains.length) return { items: [] };
    const fams = await db.itemFamily.findMany({ where: { status: 'DRAFT', blueprint: { tier: 'EXPERT', version: { package: { domain: { in: domains } } } } }, include: { instances: { where: { status: 'SAMPLE' }, take: 3 } } });
    return { items: fams.filter((f) => !((f.approvals as { userId: string }[]) ?? []).some((a) => a.userId === req.candidate!.smeUserId)).map((f) => ({ id: f.id, competency: f.competency, itemType: f.itemType, stemPattern: f.stemPattern, citation: f.citation, samples: f.instances.map((i) => ({ stem: i.stem, content: i.content })) })) };
  });

  app.post('/me/expert-reviews/:id/approve', { config: { access: 'candidate' }, schema: { tags: ['cert'], params: IdParams } }, async (req, reply) => {
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const f = await tx.itemFamily.findUnique({ where: { id: req.params.id }, include: { blueprint: { include: { version: { include: { package: true } } } } } });
      if (!f || f.blueprint.tier !== 'EXPERT') throw notFound('Item family not found');
      if (!(await expertDomains(actor.smeUserId)).includes(f.blueprint.version.package.domain)) throw new AppError(403, 'NOT_AN_EXPERT', 'Only certified Experts in this domain can review these families.');
      const approvals = [...((f.approvals as { userId: string; role: string }[]) ?? []).filter((a) => a.userId !== actor.smeUserId), { userId: actor.smeUserId, role: 'EXPERT', at: new Date().toISOString() }];
      const approved = approvals.some((a) => a.role === 'ADMIN') && approvals.some((a) => a.role === 'EXPERT');
      await tx.itemFamily.update({ where: { id: f.id }, data: { approvals: approvals as Prisma.InputJsonValue, status: approved ? 'APPROVED' : f.status } });
      await audit({ entityType: 'ItemFamily', entityId: f.id, action: approved ? 'cert.family_approved' : 'cert.family_approval_recorded', after: { role: 'EXPERT' } });
      return { status: 200, body: { id: f.id, status: approved ? 'APPROVED' : f.status } };
    });
    return reply;
  });
};
