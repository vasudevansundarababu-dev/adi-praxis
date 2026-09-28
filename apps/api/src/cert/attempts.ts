import type { Certification, Prisma, TestAttempt } from '@prisma/client';
import { CERTIFICATE_MONTHS, isCorrect, isWritten, MAX_ATTEMPTS, PassRules, plantedScore, QUIZ_PASS, RETAKE_COOLDOWN_HOURS, TIER_DEFAULTS, TIER_LABELS, type Key, type PartnerWebhookEvent } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import type { SecretBox } from '../lib/secrets';
import { emitEvent } from '../outbox/outbox';
import type { writeAudit } from '../platform/audit';
import { recordState } from '../supply/submissions';
import { completeOnboardingIfDone } from '../candidate/onboarding-service';
import type { CurriculumGenerator, InstanceContent, Section } from './generator';
import { assembleForm, keyOf, type ItemDeps } from './items';
import type { SelfieCheck } from './selfie';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;
const HOUR = 3_600_000;

/**
 * The candidate's side of certification (docs/SME-SUPPLY.md sections 6, 7.4): course in order, a selfie re-check and
 * a single-use test form per attempt, deterministic scoring of objective items, and people confirming every written
 * grade. A model's score never refuses anyone; after two failed retakes a person decides.
 */

/** Tell every partner that supplied this person about a certification change, and keep their history. */
export async function notifyCertification(tx: Tx, cert: Certification, to: string, event: PartnerWebhookEvent | null, reason?: string) {
  const cand = await tx.supplyCandidate.findUnique({ where: { smeUserId: cert.smeUserId } });
  if (!cand) return;
  const subs = await tx.partnerSubmission.findMany({ where: { candidateId: cand.id, state: 'INVITED', sandbox: false, ...(cert.requisitionId ? { requisitionId: cert.requisitionId } : {}) } });
  for (const s of subs) {
    const prev = await tx.candidateStateEvent.findFirst({ where: { submissionId: s.id, dimension: 'certification' }, orderBy: { at: 'desc' } });
    await recordState(tx, s, { dimension: 'certification', from: prev?.toState ?? null, to, reason: reason ?? null, event, data: { tier: cert.tier, domain: cert.domain } }, null);
  }
}

/** Creates the certifications a selected candidate needs: one per requisition (tier, domain) with a published version. */
export async function ensureCertifications(tx: Tx, smeUserId: string) {
  const cand = await tx.supplyCandidate.findUnique({ where: { smeUserId } });
  if (!cand) return [];
  const subs = await tx.partnerSubmission.findMany({ where: { candidateId: cand.id, state: 'INVITED', sandbox: false, enrollmentId: { not: null } }, include: { requisition: true } });
  const out = [];
  for (const s of subs) {
    const e = await tx.enrollment.findUnique({ where: { id: s.enrollmentId! } });
    const r = s.requisition;
    if (e?.status !== 'SELECTED' || !r.guidelinesPackageId) continue;
    const v = await tx.guidelinesVersion.findFirst({ where: { packageId: r.guidelinesPackageId, status: 'PUBLISHED', publishedTiers: { has: r.tier }, ...(r.guidelinesVersion ? { version: r.guidelinesVersion } : {}) }, orderBy: { version: 'desc' } });
    if (!v) continue;
    const licenceRequired = r.tier === 'EXPERT' && !!(r.minimumRequirements as { licenceRequired?: boolean })?.licenceRequired;
    const existing = await tx.certification.findUnique({ where: { smeUserId_domain_tier_versionId: { smeUserId, domain: r.domain, tier: r.tier, versionId: v.id } } });
    if (existing) {
      out.push(existing);
      continue;
    }
    const c = await tx.certification.create({ data: { clientId: r.clientId, smeUserId, domain: r.domain, tier: r.tier, versionId: v.id, requisitionId: r.id, licenceRequired, licenceStatus: licenceRequired ? 'NOT_SUBMITTED' : null } });
    await tx.auditEvent.create({ data: { clientId: r.clientId, actorType: 'SYSTEM', actorId: 'cert-enrolment', entityType: 'Certification', entityId: c.id, action: 'cert.opened', after: { tier: r.tier, domain: r.domain, versionId: v.id, requisitionId: r.id } } });
    out.push(c);
  }
  return out;
}

export async function ownCertification(tx: Db | Tx, id: string, smeUserId: string) {
  const c = await tx.certification.findFirst({ where: { id, smeUserId } });
  if (!c) throw notFound('Certification not found');
  return c;
}

async function courseFor(tx: Db | Tx, cert: Certification) {
  const course = await tx.course.findUnique({ where: { versionId_tier: { versionId: cert.versionId, tier: cert.tier } }, include: { modules: { orderBy: { position: 'asc' } } } });
  if (!course || course.status !== 'APPROVED') throw new AppError(409, 'COURSE_NOT_PUBLISHED', 'The course is not published yet.');
  return course;
}

/** The course with module order enforced: a module opens when the one before it is complete. Quiz answers are hidden. */
export async function courseView(tx: Db | Tx, cert: Certification) {
  const course = await courseFor(tx, cert);
  const done = new Set(cert.completedModules);
  return {
    certificationId: cert.id,
    tier: cert.tier,
    tierLabel: TIER_LABELS[cert.tier],
    title: course.title,
    state: cert.state,
    modules: course.modules.map((m, i) => {
      const open = i === 0 || done.has(course.modules[i - 1]!.id);
      const quiz = m.quiz as { question: string; options: string[]; answerIndex: number; feedback: string; citation: string }[];
      return {
        id: m.id,
        position: m.position,
        title: m.title,
        completed: done.has(m.id),
        locked: !open,
        ...(open ? { explanation: m.explanation, goodExamples: m.goodExamples, badExamples: m.badExamples, practice: m.practice, citations: m.citations, quiz: quiz.map((q) => ({ question: q.question, options: q.options })) } : {}),
      };
    }),
  };
}

export async function completeModule(tx: Tx, cert: Certification, moduleId: string, answers: number[], audit: Audit) {
  const course = await courseFor(tx, cert);
  const idx = course.modules.findIndex((m) => m.id === moduleId);
  if (idx < 0) throw notFound('Module not found');
  if (cert.completedModules.includes(moduleId)) return { passed: true, alreadyDone: true, feedback: [] as string[], state: cert.state };
  if (idx > 0 && !cert.completedModules.includes(course.modules[idx - 1]!.id)) throw new AppError(409, 'MODULE_LOCKED', 'Finish the modules in order: complete the previous module first.');
  const quiz = course.modules[idx]!.quiz as { answerIndex: number; feedback: string }[];
  const right = quiz.filter((q, i) => answers[i] === q.answerIndex).length;
  const passed = quiz.length === 0 || right / quiz.length >= QUIZ_PASS;
  const feedback = quiz.map((q, i) => (answers[i] === q.answerIndex ? 'Correct.' : q.feedback));
  if (!passed) {
    await audit({ entityType: 'Certification', entityId: cert.id, action: 'cert.quiz_failed', after: { moduleId, right, of: quiz.length } });
    return { passed: false, alreadyDone: false, feedback, state: cert.state };
  }
  const completed = [...cert.completedModules, moduleId];
  const all = completed.length >= course.modules.length;
  const state = all && (cert.state === 'NOT_STARTED' || cert.state === 'IN_TRAINING') ? 'TEST_READY' : cert.state === 'NOT_STARTED' ? 'IN_TRAINING' : cert.state;
  const updated = await tx.certification.update({ where: { id: cert.id }, data: { completedModules: completed, state } });
  await audit({ entityType: 'Certification', entityId: cert.id, action: 'cert.module_completed', before: { state: cert.state }, after: { moduleId, state } });
  if (state === 'TEST_READY' && cert.state !== 'TEST_READY') await notifyCertification(tx, updated, 'TEST_READY', 'candidate.training_completed');
  else if (state === 'IN_TRAINING' && cert.state === 'NOT_STARTED') await notifyCertification(tx, updated, 'IN_TRAINING', null);
  return { passed: true, alreadyDone: false, feedback, state };
}

async function publishedBlueprint(db: Db | Tx, cert: Certification) {
  const v = await db.guidelinesVersion.findUniqueOrThrow({ where: { id: cert.versionId } });
  const bp = await db.certificationBlueprint.findUnique({ where: { versionId_tier: { versionId: cert.versionId, tier: cert.tier } } });
  if (!bp || bp.status !== 'APPROVED' || !v.publishedTiers.includes(cert.tier)) throw new AppError(409, 'TEST_NOT_PUBLISHED', 'This certification is not published yet.');
  return { v, bp };
}

/** Checks before a test can start (outside a transaction, so a form can be assembled if the buffer is empty). */
export async function checkCanStart(db: Db, cert: Certification, now = new Date()) {
  if (!['TEST_READY', 'RETAKE_AVAILABLE'].includes(cert.state)) throw new AppError(409, 'NOT_READY', cert.state === 'NOT_STARTED' || cert.state === 'IN_TRAINING' ? 'Complete the course before the test.' : `This certification is ${cert.state.toLowerCase().replace(/_/g, ' ')}.`);
  if (cert.state === 'RETAKE_AVAILABLE' && cert.retakeAvailableAt && cert.retakeAvailableAt > now) throw new AppError(409, 'RETAKE_COOLDOWN', `You can retake the test from ${cert.retakeAvailableAt.toISOString()}.`);
  if (cert.attemptsUsed >= MAX_ATTEMPTS) throw new AppError(409, 'NO_ATTEMPTS_LEFT', 'No attempts are left; a person will review your certification.');
  const pre = TIER_DEFAULTS[cert.tier].prerequisite;
  if (pre && !(await db.certification.findFirst({ where: { smeUserId: cert.smeUserId, domain: cert.domain, tier: pre, state: 'PASSED' } }))) {
    throw new AppError(409, 'PREREQUISITE_MISSING', `The ${TIER_LABELS[cert.tier]} certification needs a ${TIER_LABELS[pre]} certificate in ${cert.domain} first.`);
  }
  return publishedBlueprint(db, cert);
}

/** Ensures a buffered form exists for the blueprint (assembles one now if the worker has not). */
export async function ensureForm(deps: ItemDeps, blueprintId: string, sections: Section[]) {
  if (await deps.db.testForm.count({ where: { blueprintId, status: 'BUFFERED' } })) return;
  await assembleForm(deps, blueprintId, sections);
}

export async function startTest(tx: Tx, cert: Certification, sessionRef: string, selfie: SelfieCheck, audit: Audit, now = new Date()) {
  const fresh = await tx.certification.findUniqueOrThrow({ where: { id: cert.id } });
  await tx.$executeRaw`SELECT 1 FROM "Certification" WHERE id = ${cert.id}::uuid FOR UPDATE`;
  const { bp } = await publishedBlueprintOrThrow(tx, fresh, now);
  const check = await selfie.result(sessionRef, fresh.smeUserId);
  if (check !== 'verified') throw new AppError(409, 'SELFIE_CHECK_REQUIRED', check === 'pending' ? 'Your selfie check is still being processed. Try again in a moment.' : 'Complete the selfie check before starting the test.');
  if (await tx.testAttempt.findFirst({ where: { certificationId: fresh.id, identityCheck: { path: ['sessionRef'], equals: sessionRef } } })) throw new AppError(409, 'SELFIE_ALREADY_USED', 'Each attempt needs a new selfie check.');
  // Take the oldest buffered form; it is used once.
  const [form] = await tx.$queryRaw<{ id: string; item_ids: string[] }[]>`SELECT id, item_ids FROM "TestForm" WHERE blueprint_id = ${bp.id}::uuid AND status = 'BUFFERED' ORDER BY assembled_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
  if (!form) throw new AppError(503, 'NO_FORM_READY', 'Your test is being prepared. Try again in a minute.');
  // Attempt numbers keep counting after a person allows another retake; the budget is attemptsUsed.
  const attemptNo = (await tx.testAttempt.count({ where: { certificationId: fresh.id } })) + 1;
  const attempt = await tx.testAttempt.create({
    data: { clientId: fresh.clientId, certificationId: fresh.id, smeUserId: fresh.smeUserId, attemptNo, formId: form.id, itemIds: form.item_ids, identityCheck: { provider: selfie.mode, sessionRef, result: check, at: now.toISOString() }, startedAt: now, deadlineAt: new Date(now.getTime() + bp.timeLimitMinutes * 60_000) },
  });
  await tx.testForm.update({ where: { id: form.id }, data: { status: 'USED', usedBy: attempt.id, usedAt: now } });
  // Served once, to this candidate only.
  const served = await tx.itemInstance.updateMany({ where: { id: { in: form.item_ids }, servedTo: null, status: 'VALID' }, data: { servedTo: fresh.smeUserId, servedAt: now } });
  if (served.count !== form.item_ids.length) throw new AppError(409, 'FORM_CONFLICT', 'This form was already used. Try again.');
  await tx.certification.update({ where: { id: fresh.id }, data: { state: 'IN_TEST', attemptsUsed: fresh.attemptsUsed + 1 } });
  await audit({ entityType: 'TestAttempt', entityId: attempt.id, action: 'cert.test_started', after: { certificationId: fresh.id, attemptNo, formId: form.id, items: form.item_ids.length, selfie: check } });
  return attempt;
}

async function publishedBlueprintOrThrow(tx: Tx, cert: Certification, now: Date) {
  if (!['TEST_READY', 'RETAKE_AVAILABLE'].includes(cert.state)) throw new AppError(409, 'NOT_READY', 'This certification is not ready for a test.');
  if (cert.state === 'RETAKE_AVAILABLE' && cert.retakeAvailableAt && cert.retakeAvailableAt > now) throw new AppError(409, 'RETAKE_COOLDOWN', `You can retake the test from ${cert.retakeAvailableAt.toISOString()}.`);
  return publishedBlueprint(tx, cert);
}

/** The candidate's view of an attempt: questions and their own answers; never keys. */
export async function attemptView(tx: Db | Tx, a: TestAttempt) {
  const items = await tx.itemInstance.findMany({ where: { id: { in: a.itemIds } }, include: { family: { select: { itemType: true, competency: true } } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    attemptId: a.id,
    attemptNo: a.attemptNo,
    status: a.status,
    startedAt: a.startedAt.toISOString(),
    deadlineAt: a.deadlineAt.toISOString(),
    submittedAt: a.submittedAt?.toISOString() ?? null,
    answers: a.answers,
    items: a.itemIds.map((id, n) => {
      const i = byId.get(id)!;
      return { id, number: n + 1, itemType: i.family.itemType, competency: i.family.competency, stem: i.stem, content: i.content as InstanceContent };
    }),
  };
}

const GRACE_MS = 60_000;

export async function saveAnswers(tx: Tx, a: TestAttempt, answers: Record<string, unknown>, now = new Date()) {
  if (a.status !== 'IN_PROGRESS') throw new AppError(409, 'SUBMITTED', 'This test was already submitted.');
  if (now.getTime() > a.deadlineAt.getTime() + GRACE_MS) throw new AppError(409, 'TIME_UP', 'Time is up; your saved answers will be marked.');
  const allowed = Object.fromEntries(Object.entries(answers).filter(([k]) => a.itemIds.includes(k)));
  return tx.testAttempt.update({ where: { id: a.id }, data: { answers: { ...(a.answers as object), ...allowed } as Prisma.InputJsonValue } });
}

export async function logIntegrity(tx: Tx, a: TestAttempt, events: { type: string; at: string; detail?: string }[]) {
  const list = [...((a.integrityEvents as unknown[]) ?? []), ...events.map((e) => ({ type: e.type, at: e.at, detail: e.detail?.slice(0, 200) ?? null }))].slice(-500);
  return tx.testAttempt.update({ where: { id: a.id }, data: { integrityEvents: list as Prisma.InputJsonValue } });
}

type Grade = { correct?: boolean; planted?: { found: number; planted: number; falsePositives: number }; recommendation?: { score: number; rationale: string; model: string }; confirmations?: { by: string; kind: 'INTERNAL' | 'EXPERT'; role?: string; score: number; at: string }[]; confirmedScore?: number | null; required?: number; critical?: boolean; written?: boolean; competency?: string };

/**
 * Submits (or auto-submits after the deadline): objective items are scored against the derived keys; written answers
 * get a model recommendation and wait for people. The result is decided in `finalize` once every grade is confirmed.
 */
export async function submitAttempt(db: Db, deps: { box: SecretBox; gen: CurriculumGenerator }, attemptId: string, by: { actorType: 'CANDIDATE' | 'SYSTEM'; actorId: string } = { actorType: 'SYSTEM', actorId: 'cert-deadline' }, now = new Date()) {
  const a = await db.testAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { certification: true } });
  if (a.status !== 'IN_PROGRESS') return a;
  const bp = await db.certificationBlueprint.findUniqueOrThrow({ where: { versionId_tier: { versionId: a.certification.versionId, tier: a.certification.tier } } });
  const rules = PassRules.parse(bp.passRules);
  const v = await db.guidelinesVersion.findUniqueOrThrow({ where: { id: a.certification.versionId } });
  const sections = v.sections as unknown as Section[];
  const items = await db.itemInstance.findMany({ where: { id: { in: a.itemIds } }, include: { family: true } });
  const answers = a.answers as Record<string, unknown>;
  const grading: Record<string, Grade> = {};
  for (const i of items) {
    const key = keyOf(deps.box, i.keyEnc) as Key;
    const t = i.family.itemType;
    if (isWritten(t)) {
      const text = typeof answers[i.id] === 'string' ? (answers[i.id] as string) : '';
      const s = sections.find((x) => x.anchor === i.family.citation);
      const rec = text.trim() ? await deps.gen.grade({ itemType: t, stem: i.stem, rubric: (i.content as InstanceContent).rubric ?? [] }, text, s ? s.text : '') : { score: 0, rationale: 'No answer was given.', criteria: [] };
      grading[i.id] = { written: true, competency: i.family.competency, recommendation: { score: rec.score, rationale: rec.rationale, model: deps.gen.model }, confirmations: [], confirmedScore: null, required: t === 'AUTHORING' ? rules.confirmationsRequired : 1 };
    } else if (t === 'TRAJECTORY_REVIEW') {
      const p = plantedScore((key as string[]) ?? [], answers[i.id]);
      grading[i.id] = { correct: p.found === p.planted && p.falsePositives === 0, planted: p, critical: i.family.critical, competency: i.family.competency };
    } else {
      grading[i.id] = { correct: isCorrect(t, key, answers[i.id]), critical: i.family.critical, competency: i.family.competency };
    }
  }
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.testAttempt.update({ where: { id: a.id }, data: { status: 'NEEDS_REVIEW', submittedAt: now, grading: grading as Prisma.InputJsonValue } });
    // Item statistics for recalibration.
    for (const i of items) {
      const g = grading[i.id]!;
      if (g.written) continue;
      const st = (i.family.stats ?? {}) as { served?: number; correct?: number };
      await tx.itemFamily.update({ where: { id: i.family.id }, data: { stats: { ...(i.family.stats as object), served: (st.served ?? 0) + 1, correct: (st.correct ?? 0) + (g.correct ? 1 : 0) } as Prisma.InputJsonValue } });
    }
    const entry = { entityType: 'TestAttempt', entityId: a.id, action: 'cert.test_submitted', after: { items: items.length, written: Object.values(grading).filter((g) => g.written).length, late: now > a.deadlineAt } };
    await tx.auditEvent.create({ data: { clientId: a.clientId, ...by, ...entry } });
    return u;
  });
  return finalize(db, updated.id);
}

/** Decides the result once every written grade is confirmed. Objective-only tests are decided at once. */
export async function finalize(db: Db, attemptId: string) {
  return db.$transaction((tx) => finalizeTx(tx, attemptId));
}

/** `finalize` inside a caller's transaction (e.g. together with the grade confirmation that completes the review). */
export async function finalizeTx(tx: Tx, attemptId: string) {
  {
    await tx.$executeRaw`SELECT 1 FROM "TestAttempt" WHERE id = ${attemptId}::uuid FOR UPDATE`;
    const a = await tx.testAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { certification: true } });
    if (a.status !== 'NEEDS_REVIEW') return a;
    const grading = a.grading as Record<string, Grade>;
    const gs = Object.values(grading);
    if (gs.some((g) => g.written && (g.confirmations?.length ?? 0) < (g.required ?? 1))) return a; // people still to confirm
    const cert = a.certification;
    const bp = await tx.certificationBlueprint.findUniqueOrThrow({ where: { versionId_tier: { versionId: cert.versionId, tier: cert.tier } } });
    const rules = PassRules.parse(bp.passRules);
    const objective = gs.filter((g) => !g.written);
    const written = gs.filter((g) => g.written);
    const objCorrect = objective.filter((g) => g.correct).length;
    const writtenScores = written.map((g) => g.confirmedScore ?? 0);
    const overall = rules.objectiveOnlyOverall ? (objective.length ? (objCorrect / objective.length) * 100 : 100) : ((objCorrect + writtenScores.reduce((n, s) => n + s, 0)) / Math.max(1, gs.length)) * 100;
    const planted = objective.filter((g) => g.planted).reduce((n, g) => ({ found: n.found + g.planted!.found, planted: n.planted + g.planted!.planted }), { found: 0, planted: 0 });
    const plantedPct = planted.planted ? (planted.found / planted.planted) * 100 : null;
    const criticalMiss = objective.some((g) => g.critical && !g.correct);
    const writtenOk = rules.objectiveOnlyOverall ? writtenScores.every((s) => s >= rules.writtenPassScore) : true;
    const sectionScores: Record<string, number> = {};
    for (const comp of new Set(gs.map((g) => g.competency!))) {
      const inComp = gs.filter((g) => g.competency === comp);
      sectionScores[comp] = Math.round((inComp.reduce((n, g) => n + (g.written ? (g.confirmedScore ?? 0) : g.correct ? 1 : 0), 0) / inComp.length) * 100);
    }
    const passed = overall >= rules.overallPct && (rules.plantedErrorsPct === null || plantedPct === null || plantedPct >= rules.plantedErrorsPct) && !(rules.noCriticalMiss && criticalMiss) && writtenOk;
    const u = await tx.testAttempt.update({ where: { id: a.id }, data: { status: passed ? 'PASSED' : 'FAILED', score: overall.toFixed(2), sectionScores: sectionScores as Prisma.InputJsonValue, result: JSON.stringify({ overall: Math.round(overall * 100) / 100, plantedPct, criticalMiss, writtenOk }) } });
    await tx.auditEvent.create({ data: { clientId: a.clientId, actorType: 'SYSTEM', actorId: 'cert-scoring', entityType: 'TestAttempt', entityId: a.id, action: passed ? 'cert.test_passed' : 'cert.test_failed', after: { overall, plantedPct, criticalMiss, writtenOk, sectionScores } } });
    if (passed) {
      if (cert.licenceRequired && cert.licenceStatus !== 'CONFIRMED') {
        const c = await tx.certification.update({ where: { id: cert.id }, data: { state: 'REVIEW_REQUIRED', reviewReason: 'Test passed; waiting for the professional licence to be confirmed by a Validator.' } });
        await notifyCertification(tx, c, 'REVIEW_REQUIRED', 'candidate.test_passed', 'Licence confirmation pending');
      } else await certify(tx, cert, null, 'Passed the certification test');
    } else if (cert.attemptsUsed >= MAX_ATTEMPTS) {
      const c = await tx.certification.update({ where: { id: cert.id }, data: { state: 'REVIEW_REQUIRED', reviewReason: `Failed ${MAX_ATTEMPTS} attempts; a person decides.` } });
      await notifyCertification(tx, c, 'REVIEW_REQUIRED', 'candidate.test_failed');
    } else {
      const c = await tx.certification.update({ where: { id: cert.id }, data: { state: 'RETAKE_AVAILABLE', retakeAvailableAt: new Date(Date.now() + RETAKE_COOLDOWN_HOURS * HOUR) } });
      await notifyCertification(tx, c, 'RETAKE_AVAILABLE', 'candidate.test_failed');
    }
    return u;
  }
}

/** Certifies: PASSED for 12 months, standing starts on probation, partners are told, and onboarding may complete. */
export async function certify(tx: Tx, cert: Certification, decidedBy: string | null, reason: string) {
  const now = new Date();
  const expires = new Date(now);
  expires.setMonth(expires.getMonth() + CERTIFICATE_MONTHS);
  const c = await tx.certification.update({ where: { id: cert.id }, data: { state: 'PASSED', issuedAt: now, expiresAt: expires, decidedBy, reviewReason: null, retakeAvailableAt: null } });
  await tx.auditEvent.create({ data: { clientId: cert.clientId, actorType: decidedBy ? 'USER' : 'SYSTEM', actorId: decidedBy ?? 'cert-scoring', entityType: 'Certification', entityId: cert.id, action: 'cert.certified', after: { tier: cert.tier, domain: cert.domain, expiresAt: expires.toISOString(), reason } } });
  const standing = await tx.smeStanding.findFirst({ where: { smeUserId: cert.smeUserId, domain: cert.domain }, orderBy: { createdAt: 'desc' } });
  if (!standing || standing.tier !== cert.tier) await tx.smeStanding.create({ data: { clientId: cert.clientId, smeUserId: cert.smeUserId, domain: cert.domain, tier: cert.tier, standing: 'PROBATION', reason: 'Certified; first 50 approved tasks on probation', approvedById: decidedBy } });
  await notifyCertification(tx, c, 'PASSED', 'candidate.test_passed');
  await notifyCertification(tx, c, 'CERTIFIED', 'candidate.certified');
  await emitEvent(tx, cert.clientId, { name: 'cert.certified', aggregateType: 'Certification', aggregateId: cert.id, payload: { certificationId: cert.id, smeUserId: cert.smeUserId, tier: cert.tier, domain: cert.domain, requisitionId: cert.requisitionId } });
  // The C07 checklist may now be complete (the certification item was the last one).
  await completeOnboardingIfDone(tx, cert.smeUserId);
  return c;
}

/** Can this person confirm written grades for this attempt (separation of duties, two-person rule for Experts)? */
export async function confirmGrade(tx: Tx, args: { attemptId: string; itemId: string; score: number; confirmer: { kind: 'INTERNAL'; userId: string; roles: string[] } | { kind: 'EXPERT'; smeUserId: string } }) {
  const a = await tx.testAttempt.findUnique({ where: { id: args.attemptId }, include: { certification: true } });
  if (!a) throw notFound('Test not found');
  if (a.status !== 'NEEDS_REVIEW') throw new AppError(409, 'NOT_AWAITING_REVIEW', 'This test is not waiting for grades.');
  const grading = a.grading as Record<string, Grade>;
  const g = grading[args.itemId];
  if (!g?.written) throw notFound('Written answer not found');
  const who = args.confirmer.kind === 'INTERNAL' ? args.confirmer.userId : args.confirmer.smeUserId;
  if ((g.confirmations ?? []).some((c) => c.by === who)) throw new AppError(409, 'ALREADY_CONFIRMED', 'You already confirmed this grade; a different person must confirm too.');
  const item = await tx.itemInstance.findUniqueOrThrow({ where: { id: args.itemId }, include: { family: true } });
  const authoring = item.family.itemType === 'AUTHORING';
  const domain = a.certification.domain;
  const experts = await tx.certification.count({ where: { domain, tier: 'EXPERT', state: 'PASSED', smeUserId: { not: a.smeUserId } } });
  if (args.confirmer.kind === 'EXPERT') {
    const ok = await tx.certification.findFirst({ where: { smeUserId: args.confirmer.smeUserId, domain, tier: 'EXPERT', state: 'PASSED' } });
    if (!ok || args.confirmer.smeUserId === a.smeUserId) throw new AppError(403, 'NOT_AN_EXPERT', 'Only certified Experts in this domain can confirm.');
    // An assessor never grades a candidate from a partner they are linked to.
    const mine = await tx.supplyCandidate.findUnique({ where: { smeUserId: args.confirmer.smeUserId }, include: { submissions: { select: { partnerId: true } } } });
    const theirs = await tx.supplyCandidate.findUnique({ where: { smeUserId: a.smeUserId }, include: { submissions: { select: { partnerId: true } } } });
    const shared = (mine?.submissions ?? []).some((s) => s.partnerId && (theirs?.submissions ?? []).some((t) => t.partnerId === s.partnerId));
    if (shared) throw new AppError(403, 'CONFLICT_PARTNER', 'You are linked to the same partner as this candidate; another Expert must confirm.');
  } else if (authoring && experts >= 2) {
    throw new AppError(403, 'EXPERTS_REQUIRED', 'This domain has certified Experts: two of them confirm the authoring task.');
  }
  const role = args.confirmer.kind === 'INTERNAL' ? (args.confirmer.roles.includes('ADMIN') ? 'ADMIN' : 'REVIEWER') : 'EXPERT';
  const confirmations = [...(g.confirmations ?? []), { by: who, kind: args.confirmer.kind, role, score: args.score, at: new Date().toISOString() }];
  // Until the domain has two certified Experts, the authoring task needs an Admin and a Validator.
  if (authoring && args.confirmer.kind === 'INTERNAL' && confirmations.length >= 2) {
    const roles = new Set(confirmations.map((c) => c.role));
    if (!(roles.has('ADMIN') && roles.has('REVIEWER'))) throw new AppError(409, 'SECOND_ROLE_NEEDED', 'The second confirmation must come from the other role (Admin and Validator).');
  }
  const done = confirmations.length >= (g.required ?? 1);
  grading[args.itemId] = { ...g, confirmations, confirmedScore: done ? confirmations.reduce((n, c) => n + c.score, 0) / confirmations.length : null };
  await tx.testAttempt.update({ where: { id: a.id }, data: { grading: grading as Prisma.InputJsonValue } });
  return { done, confirmations: confirmations.length, required: g.required ?? 1 };
}

/** A person decides a certification under review: certify, not certified, or allow another retake. */
export async function decideCertification(tx: Tx, cert: Certification, decision: 'CERTIFY' | 'NOT_CERTIFIED' | 'ALLOW_RETAKE', reason: string, userId: string) {
  if (cert.state !== 'REVIEW_REQUIRED') throw new AppError(409, 'NOT_UNDER_REVIEW', 'Only certifications under review can be decided here.');
  if (decision === 'CERTIFY') {
    if (cert.licenceRequired && cert.licenceStatus !== 'CONFIRMED') throw new AppError(409, 'LICENCE_NOT_CONFIRMED', 'Confirm the professional licence first.');
    return certify(tx, cert, userId, reason);
  }
  if (decision === 'ALLOW_RETAKE') {
    const c = await tx.certification.update({ where: { id: cert.id }, data: { state: 'RETAKE_AVAILABLE', retakeAvailableAt: new Date(), attemptsUsed: Math.min(cert.attemptsUsed, MAX_ATTEMPTS - 1), decidedBy: userId, reviewReason: null } });
    await notifyCertification(tx, c, 'RETAKE_AVAILABLE', null, reason);
    return c;
  }
  const c = await tx.certification.update({ where: { id: cert.id }, data: { state: 'NOT_CERTIFIED', decidedBy: userId, reviewReason: reason } });
  await notifyCertification(tx, c, 'NOT_CERTIFIED', 'candidate.test_failed', reason);
  return c;
}

/** Candidate submits a professional licence (healthcare Experts): number, issuing body and certificate file. */
export async function submitLicence(tx: Tx, cert: Certification, licence: { number: string; issuingBody: string; fileName: string; storageKey: string }, audit: Audit) {
  if (!cert.licenceRequired) throw new AppError(409, 'LICENCE_NOT_REQUIRED', 'This certification does not need a licence.');
  if (cert.licenceStatus === 'CONFIRMED') throw new AppError(409, 'LICENCE_CONFIRMED', 'Your licence is already confirmed.');
  const c = await tx.certification.update({ where: { id: cert.id }, data: { licence: { ...licence, submittedAt: new Date().toISOString() }, licenceStatus: 'PENDING' } });
  await audit({ entityType: 'Certification', entityId: cert.id, action: 'cert.licence_submitted', after: { issuingBody: licence.issuingBody } });
  return c;
}

/** A Validator checks the licence number, issuing body and certificate. A confirmed licence releases a passed test. */
export async function decideLicence(tx: Tx, cert: Certification, confirm: boolean, note: string, userId: string, audit: Audit) {
  if (cert.licenceStatus !== 'PENDING') throw new AppError(409, 'NO_LICENCE_PENDING', 'There is no licence waiting for a decision.');
  let c = await tx.certification.update({ where: { id: cert.id }, data: { licenceStatus: confirm ? 'CONFIRMED' : 'REJECTED', licenceDecidedBy: userId } });
  await audit({ entityType: 'Certification', entityId: cert.id, action: confirm ? 'cert.licence_confirmed' : 'cert.licence_rejected', after: { note } });
  const passed = await tx.testAttempt.findFirst({ where: { certificationId: cert.id, status: 'PASSED' } });
  if (confirm && c.state === 'REVIEW_REQUIRED' && passed) c = await certify(tx, c, userId, 'Licence confirmed after a passed test');
  return c;
}

/** Hourly: tests past their deadline are submitted with the saved answers; certificates past 12 months expire. */
export async function sweepCertifications(db: Db, deps: { box: SecretBox; gen: CurriculumGenerator }, now = new Date()) {
  const late = await db.testAttempt.findMany({ where: { status: 'IN_PROGRESS', deadlineAt: { lt: new Date(now.getTime() - GRACE_MS) } }, select: { id: true } });
  for (const a of late) await submitAttempt(db, deps, a.id, undefined, now);
  const expired = await db.certification.findMany({ where: { state: 'PASSED', expiresAt: { lt: now } } });
  for (const c of expired) {
    await db.$transaction(async (tx) => {
      const u = await tx.certification.update({ where: { id: c.id }, data: { state: 'EXPIRED' } });
      await tx.auditEvent.create({ data: { clientId: c.clientId, actorType: 'SYSTEM', actorId: 'cert-expiry', entityType: 'Certification', entityId: c.id, action: 'cert.expired', after: { expiredAt: c.expiresAt?.toISOString() } } });
      await notifyCertification(tx, u, 'EXPIRED', null);
    });
  }
  return { submitted: late.length, expired: expired.length };
}

export type { ItemDeps };
