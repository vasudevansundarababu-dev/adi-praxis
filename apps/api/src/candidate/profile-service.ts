import type { ConversationTurn, Prisma } from '@prisma/client';
import {
  experienceDurations,
  FIELD_DEFS,
  fieldLabel,
  MAX_CLARIFICATIONS,
  nextQuestion,
  OpportunityBrief,
  OpportunityCriteria,
  ProfileData,
  questionCovered,
  QuestionPolicy,
  readiness,
  defaultQuestionPolicy,
  type CorrectionsRequest,
  type FieldValue,
  type ProfileField,
  type QuestionDef,
} from '@praxis/shared';
import { randomUUID } from 'node:crypto';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import { writeAudit } from '../platform/audit';
import type { ExtractionResult, ProfileAssistant } from './profile-assistant';

export const EDITABLE_ENROLLMENT = ['DRAFT', 'NEEDS_INFORMATION'] as const;

const auditCtx = (clientId: string, smeUserId: string, requestId?: string) => ({ clientId, actorType: 'CANDIDATE' as const, actorId: smeUserId, requestId });

// ───────────────────────── Loading ─────────────────────────

/** The candidate's own enrollment, or 404 (never leaks other candidates' objects; CF-28). */
export async function ownEnrollment(tx: Db | Tx, enrollmentId: string, smeUserId: string) {
  const e = await tx.enrollment.findFirst({
    where: { id: enrollmentId, smeUserId },
    include: { opportunityVersion: true, smeUser: true, conversation: true },
  });
  if (!e) throw notFound('Application not found');
  return e;
}

/** The pinned version's question policy; a version published before M4b falls back to the default policy. */
export function policyFor(v: { brief: unknown; criteria: unknown; questionPolicy: unknown }): { policy: QuestionPolicy; brief: OpportunityBrief; criteria: OpportunityCriteria } {
  const brief = OpportunityBrief.parse(v.brief);
  const criteria = OpportunityCriteria.parse(v.criteria);
  const stored = QuestionPolicy.safeParse(v.questionPolicy);
  return { policy: stored.success ? stored.data : defaultQuestionPolicy(brief, criteria), brief, criteria };
}

export async function draftProfile(tx: Db | Tx, enrollmentId: string) {
  return tx.profileVersion.findFirst({ where: { enrollmentId, submittedAt: null }, orderBy: { version: 'desc' } });
}

async function nextSequence(tx: Tx, sessionId: string) {
  const last = await tx.conversationTurn.findFirst({ where: { sessionId }, orderBy: { sequence: 'desc' } });
  return (last?.sequence ?? 0) + 1;
}

async function say(tx: Tx, session: { id: string; clientId: string }, content: string, questionId: string | null = null, speaker: 'ASSISTANT' | 'SYSTEM' = 'ASSISTANT') {
  await tx.conversationTurn.create({
    data: { clientId: session.clientId, sessionId: session.id, clientMessageId: `srv-${randomUUID()}`, sequence: await nextSequence(tx, session.id), speaker, content, questionId, acknowledgedAt: new Date() },
  });
}

const askText = (q: QuestionDef) => (q.options.length ? `${q.text}\n(For example: ${q.options.join(', ')}.)` : q.text);

/**
 * Starts the conversation for an enrollment (idempotent): session, a draft profile for this pool that reuses the
 * candidate's previously confirmed facts, a greeting and the first relevant question (FLOW2 C04, section 2).
 */
export async function ensureConversation(tx: Tx, enrollmentId: string, smeUserId: string) {
  const e = await ownEnrollment(tx, enrollmentId, smeUserId);
  if (e.conversation) return e.conversation;
  const { policy } = policyFor(e.opportunityVersion);

  // Reuse confirmed, non-pool-specific facts from the latest submitted profile (ask only incremental questions).
  const prior = await tx.profileVersion.findFirst({ where: { smeUserId, submittedAt: { not: null } }, orderBy: { version: 'desc' } });
  const base = ProfileData.parse({});
  if (prior) {
    const old = ProfileData.parse(prior.data);
    for (const [k, v] of Object.entries(old.fields)) if (v.status === 'CONFIRMED' && !k.startsWith('criterion:')) base.fields[k] = { ...v, reused: true };
    base.roles = old.roles.filter((r) => r.status === 'CONFIRMED').map((r) => ({ ...r, reused: true }));
    base.claims = old.claims.filter((c) => c.status === 'CONFIRMED');
  }
  const last = await tx.profileVersion.findFirst({ where: { smeUserId }, orderBy: { version: 'desc' } });
  await tx.profileVersion.create({
    data: { clientId: e.clientId, smeUserId, enrollmentId, version: (last?.version ?? 0) + 1, data: base as unknown as Prisma.InputJsonValue, contentHash: '' },
  });
  const session = await tx.conversationSession.create({ data: { clientId: e.clientId, enrollmentId, status: 'IN_PROGRESS' } });
  await say(
    tx,
    session,
    `Hi${e.smeUser.displayName ? ` ${e.smeUser.displayName.split(' ')[0]}` : ''}. I’ll ask about the work you have actually done, one question at a time. You can say “I don’t know” or “I can’t disclose”, skip optional questions, and edit anything before you submit.${prior ? ' I’ve kept the facts you confirmed before, so I’ll only ask what this opportunity adds.' : ''} Please don’t share real customer or confidential employer information.`,
  );
  const first = nextQuestion(policy, base);
  if (first) await say(tx, session, askText(first), first.id);
  await writeAudit(tx, auditCtx(e.clientId, smeUserId), { entityType: 'Enrollment', entityId: e.id, action: 'conversation.started', after: { reusedFacts: Object.keys(base.fields).length } });
  return session;
}

// ───────────────────────── Merging ─────────────────────────

function factValue(f: ExtractionResult['facts'][number]): FieldValue | null {
  if (f.list && f.list.length) return f.list;
  if (f.number !== null) return f.number;
  return f.text?.trim() ? f.text.trim() : null;
}

/**
 * Adds extracted facts as PROPOSED, linked to their source turn. A confirmed value is never overwritten silently:
 * a disagreeing extraction is recorded as a conflict for the candidate to resolve (FLOW2 5.2 step 3).
 */
export function mergeExtraction(p: ProfileData, r: ExtractionResult, turnId: string): ProfileData {
  const next: ProfileData = structuredClone(p);
  for (const f of r.facts) {
    const value = factValue(f);
    if (value === null) continue;
    const current = next.fields[f.fieldKey];
    if (current?.status === 'CONFIRMED') {
      if (stableStringify(current.value) !== stableStringify(value)) next.fields[f.fieldKey] = { ...current, conflictWith: value, sources: [...current.sources, turnId] };
      continue;
    }
    // A later answer adds to a still-unconfirmed list rather than replacing it.
    if (current?.status === 'PROPOSED' && Array.isArray(current.value) && Array.isArray(value)) {
      const seen = new Set(current.value.map((x) => x.toLowerCase()));
      next.fields[f.fieldKey] = { ...current, value: [...current.value, ...value.filter((x) => !seen.has(x.toLowerCase()))], sources: [...current.sources, turnId] };
      continue;
    }
    next.fields[f.fieldKey] = { value, status: 'PROPOSED', approximate: f.approximate, sources: [turnId], conflictWith: null, reused: false };
  }
  for (const role of r.roles) {
    if (next.roles.some((x) => x.title.toLowerCase() === role.title.toLowerCase() && x.start === role.start)) continue;
    next.roles.push({
      id: randomUUID(),
      title: role.title,
      employerType: role.employerType ?? '',
      employerName: null,
      start: role.start,
      end: role.current ? null : role.end,
      approximate: role.approximate,
      specialtyRelevant: role.specialtyRelevant,
      responsibility: role.responsibility,
      status: 'PROPOSED',
      sources: [turnId],
      reused: false,
    });
  }
  for (const c of r.claims) {
    if (next.claims.some((x) => x.value.toLowerCase() === c.value.toLowerCase())) continue;
    next.claims.push({ id: randomUUID(), type: c.type, value: c.value, issuer: c.issuer, validFrom: null, expiresAt: c.expiresAt, status: 'PROPOSED', evidenceLevel: 'SELF_REPORTED', evidenceIds: [], sources: [turnId] });
  }
  return next;
}

/** "I don't know" / "I can't disclose" / "Skip": explicit, penalty-free states; never a default value (CF-11, CF-12). */
export function applyQuickReply(p: ProfileData, q: QuestionDef, reply: 'DONT_KNOW' | 'CANNOT_DISCLOSE' | 'SKIP', turnId: string): ProfileData {
  const status = reply === 'DONT_KNOW' ? 'UNKNOWN' : reply === 'CANNOT_DISCLOSE' ? 'DECLINED' : 'SKIPPED';
  const next: ProfileData = structuredClone(p);
  for (const f of q.fields) {
    if (next.fields[f]?.status === 'CONFIRMED') continue;
    next.fields[f] = { value: null, status, approximate: false, sources: [turnId], conflictWith: null, reused: false };
  }
  return next;
}

/** Candidate corrections from the profile panel, review page or accessible form. Candidate-entered values are confirmed. */
export function applyCorrections(p: ProfileData, c: CorrectionsRequest, allowedFields: Set<string>): ProfileData {
  const next: ProfileData = structuredClone(p);
  for (const ch of c.fields) {
    if (!allowedFields.has(ch.fieldKey)) throw new AppError(400, 'UNKNOWN_FIELD', `Unknown profile field "${ch.fieldKey}"`);
    const cur = next.fields[ch.fieldKey];
    const base: ProfileField = cur ?? { value: null, status: 'UNKNOWN', approximate: false, sources: [], conflictWith: null, reused: false };
    switch (ch.action) {
      case 'CONFIRM':
        if (!cur || cur.value === null) throw new AppError(400, 'NOTHING_TO_CONFIRM', `Nothing to confirm for ${fieldLabel(ch.fieldKey)}`);
        // Confirming while a conflict is open keeps the confirmed value and dismisses the conflicting extraction.
        next.fields[ch.fieldKey] = { ...cur, status: 'CONFIRMED', conflictWith: null };
        break;
      case 'EDIT':
        if (ch.value === undefined) throw new AppError(400, 'VALUE_REQUIRED', `A value is required for ${fieldLabel(ch.fieldKey)}`);
        next.fields[ch.fieldKey] = { ...base, value: ch.value, status: 'CONFIRMED', conflictWith: null, sources: [...base.sources, 'candidate-edit'] };
        break;
      case 'UNKNOWN':
      case 'DECLINE':
      case 'SKIP':
        next.fields[ch.fieldKey] = { ...base, value: null, status: ch.action === 'UNKNOWN' ? 'UNKNOWN' : ch.action === 'DECLINE' ? 'DECLINED' : 'SKIPPED', conflictWith: null };
        break;
      case 'CLEAR':
        delete next.fields[ch.fieldKey];
        break;
    }
  }
  for (const ch of c.roles) {
    const i = next.roles.findIndex((r) => r.id === ch.id);
    if (ch.action === 'ADD') {
      if (!ch.role?.title) throw new AppError(400, 'VALUE_REQUIRED', 'A role needs a title');
      next.roles.push({ employerType: '', employerName: null, approximate: false, specialtyRelevant: true, responsibility: null, ...ch.role, start: ch.role.start ?? null, end: ch.role.end ?? null, id: randomUUID(), status: 'CONFIRMED', sources: ['candidate-edit'], reused: false });
      continue;
    }
    if (i < 0) throw new AppError(404, 'NOT_FOUND', 'Role not found');
    if (ch.action === 'REMOVE') next.roles.splice(i, 1);
    else next.roles[i] = { ...next.roles[i]!, ...(ch.action === 'EDIT' ? ch.role : {}), status: 'CONFIRMED' };
  }
  for (const ch of c.claims) {
    const i = next.claims.findIndex((x) => x.id === ch.id);
    if (ch.action === 'ADD') {
      if (!ch.claim?.value || !ch.claim.type) throw new AppError(400, 'VALUE_REQUIRED', 'A credential needs a type and a value');
      next.claims.push({ issuer: null, validFrom: null, expiresAt: null, evidenceIds: [], ...ch.claim, id: randomUUID(), status: 'CONFIRMED', evidenceLevel: 'SELF_REPORTED', sources: ['candidate-edit'] });
      continue;
    }
    if (i < 0) throw new AppError(404, 'NOT_FOUND', 'Credential not found');
    if (ch.action === 'REMOVE') next.claims.splice(i, 1);
    // The evidence level stays SELF_REPORTED whatever the candidate sends (CF-16).
    else next.claims[i] = { ...next.claims[i]!, ...(ch.action === 'EDIT' ? ch.claim : {}), status: 'CONFIRMED', evidenceLevel: 'SELF_REPORTED' };
  }
  return ProfileData.parse(next);
}

export const allowedFieldKeys = (policy: QuestionPolicy) => new Set([...Object.keys(FIELD_DEFS), ...policy.questions.flatMap((q) => q.fields).filter((f) => f !== 'roles'), 'roles']);

export const confirmedSummary = (p: ProfileData, criteria: OpportunityCriteria) => [
  ...Object.entries(p.fields)
    .filter(([, v]) => v.status === 'CONFIRMED' && v.value !== null)
    .map(([k, v]) => `${fieldLabel(k, criteria)}: ${Array.isArray(v.value) ? v.value.join(', ') : v.value}`),
  ...p.roles.filter((r) => r.status === 'CONFIRMED').map((r) => `Role: ${r.title} (${r.start ?? '?'} to ${r.end ?? 'now'})`),
];

// ───────────────────────── State for the candidate app ─────────────────────────

export async function conversationState(db: Db | Tx, enrollmentId: string, smeUserId: string) {
  const e = await ownEnrollment(db, enrollmentId, smeUserId);
  const { policy, brief, criteria } = policyFor(e.opportunityVersion);
  const session = e.conversation;
  const draft = await draftProfile(db, e.id);
  const submitted = e.profileVersionId ? await db.profileVersion.findUnique({ where: { id: e.profileVersionId } }) : null;
  const profile = ProfileData.parse((draft ?? submitted)?.data ?? {});
  const turns: ConversationTurn[] = session ? await db.conversationTurn.findMany({ where: { sessionId: session.id }, orderBy: { sequence: 'asc' } }) : [];
  const next = nextQuestion(policy, profile);
  const evidence = await db.evidenceArtifact.findMany({ where: { smeUserId, deletionRequestedAt: null }, orderBy: { createdAt: 'desc' } });
  return {
    enrollment: { id: e.id, status: e.status, submittedAt: e.submittedAt?.toISOString() ?? null, opportunityId: e.opportunityId, title: brief.title, version: e.opportunityVersion.version },
    session: session ? { status: session.status, revision: session.revision } : null,
    editable: (EDITABLE_ENROLLMENT as readonly string[]).includes(e.status),
    turns: turns.map((t) => ({
      id: t.id,
      clientMessageId: t.clientMessageId,
      speaker: t.speaker,
      content: t.content,
      questionId: t.questionId,
      redacted: t.redacted,
      extractionStatus: t.extractionStatus,
      createdAt: t.createdAt.toISOString(),
    })),
    nextQuestion: next ? { id: next.id, text: next.text, why: next.why, answerType: next.answerType, options: next.options, required: next.required, section: next.section, sensitive: next.sensitive } : null,
    questions: policy.questions.map((q) => ({ id: q.id, section: q.section, text: q.text, why: q.why, fields: q.fields, answerType: q.answerType, options: q.options, required: q.required, covered: questionCovered(q, profile) })),
    profile,
    fieldLabels: Object.fromEntries([...allowedFieldKeys(policy)].map((k) => [k, fieldLabel(k, criteria)])),
    durations: experienceDurations(profile),
    readiness: readiness(policy, profile, criteria),
    evidence: evidence.map((x) => ({ id: x.id, filename: x.filename, mimeType: x.mimeType, sizeBytes: x.sizeBytes, scanStatus: x.scanStatus, createdAt: x.createdAt.toISOString() })),
  };
}

// ───────────────────────── Messages (FLOW2 5.2 turn controller; 5.4 persistence) ─────────────────────────

export interface MessageDeps {
  db: Db;
  assistant: ProfileAssistant;
}

/**
 * Phase 2 of a message: call the model outside any transaction, then commit its proposals and the next question.
 * A model failure leaves a retryable state and never affects suitability (CF-15).
 */
export async function processCandidateTurn(deps: MessageDeps, enrollmentId: string, smeUserId: string, turnId: string) {
  const { db, assistant } = deps;
  const e = await ownEnrollment(db, enrollmentId, smeUserId);
  const { policy, brief, criteria } = policyFor(e.opportunityVersion);
  const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: turnId } });
  if (turn.extractionStatus === 'DONE' || turn.extractionStatus === 'SKIPPED') return;
  const q = policy.questions.find((x) => x.id === turn.questionId) ?? nextQuestion(policy, ProfileData.parse((await draftProfile(db, e.id))?.data ?? {}));
  if (!q) return;
  const before = ProfileData.parse((await draftProfile(db, e.id))!.data);

  let result: ExtractionResult | null = null;
  try {
    result = await assistant.extract({
      opportunity: { title: brief.title, domain: brief.domain, specialty: brief.specialty },
      question: q,
      allowedFields: [...allowedFieldKeys(policy)].filter((k) => k !== 'roles'),
      confirmedSummary: confirmedSummary(before, criteria),
      answer: turn.content,
    });
  } catch {
    result = null;
  }

  await db.$transaction(async (tx) => {
    const session = (await tx.conversationSession.findUniqueOrThrow({ where: { enrollmentId: e.id } }));
    if (!result) {
      await tx.conversationTurn.update({ where: { id: turn.id }, data: { extractionStatus: 'FAILED' } });
      await say(tx, session, 'I couldn’t process that answer just now. Your message is saved. You can retry, or answer using the form instead; this has no effect on your application.', q.id, 'SYSTEM');
      await tx.conversationSession.update({ where: { id: session.id }, data: { revision: { increment: 1 } } });
      await writeAudit(tx, auditCtx(e.clientId, smeUserId), { entityType: 'ConversationSession', entityId: session.id, action: 'conversation.extraction_failed', after: { turnId: turn.id } });
      return;
    }
    const draft = (await draftProfile(tx, e.id))!;
    let profile = ProfileData.parse(draft.data);

    if (result.containsConfidentialData) {
      // The detector missed it but the model flagged it: remove the text and do not use any of it (CF-13).
      await tx.conversationTurn.update({ where: { id: turn.id }, data: { content: '[message removed: it may contain confidential information]', redacted: true, sensitiveKinds: ['MODEL_FLAGGED'], extractionStatus: 'SKIPPED' } });
      await say(tx, session, `For your protection I haven’t kept that message: it may contain confidential or customer information. Please describe the work in generic or synthetic terms.\n\n${askText(q)}`, q.id);
    } else if (result.offTopic) {
      await tx.conversationTurn.update({ where: { id: turn.id }, data: { extractionStatus: 'DONE' } });
      await say(tx, session, `That doesn’t seem to answer this question, which is about your work for this opportunity.\n\n${askText(q)}`, q.id);
    } else {
      profile = mergeExtraction(profile, result, turn.id);
      await tx.conversationTurn.update({ where: { id: turn.id }, data: { extractionStatus: 'DONE', modelVersion: assistant.modelVersion } });
      const attempts = await tx.conversationTurn.count({ where: { sessionId: session.id, speaker: 'CANDIDATE', questionId: q.id } });
      if (!questionCovered(q, profile)) {
        if (attempts <= MAX_CLARIFICATIONS) {
          await say(tx, session, result.followUpQuestion ?? `Could you say a little more? ${askText(q)}`, q.id);
        } else {
          // Two clarifications reached: record as not known (no penalty) and offer alternatives (FLOW2 C04).
          for (const f of q.fields) if (!profile.fields[f] || profile.fields[f]!.status === 'PROPOSED') profile.fields[f] = { value: null, status: 'UNKNOWN', approximate: false, sources: [turn.id], conflictWith: null, reused: false };
          await say(tx, session, 'Thanks. I’ll note this as not known for now, which is fine. You can add evidence, edit it before submitting, or a reviewer may ask a specific question later.');
        }
      }
    }

    await tx.profileVersion.update({ where: { id: draft.id }, data: { data: profile as unknown as Prisma.InputJsonValue } });
    const lastAssistant = await tx.conversationTurn.findFirst({ where: { sessionId: session.id }, orderBy: { sequence: 'desc' } });
    const n = nextQuestion(policy, profile);
    // Ask the next question unless the last message already asks the current one.
    if (n && !(lastAssistant?.speaker === 'ASSISTANT' && lastAssistant.questionId === n.id)) await say(tx, session, askText(n), n.id);
    if (!n) await say(tx, session, 'That covers everything this opportunity needs. Please review your profile, confirm the facts I’ve proposed, and submit when you’re ready. Nothing is submitted until you choose to.');
    await tx.conversationSession.update({ where: { id: session.id }, data: { revision: { increment: 1 }, status: n ? 'IN_PROGRESS' : 'READY_TO_CONFIRM' } });
    await writeAudit(tx, auditCtx(e.clientId, smeUserId), {
      entityType: 'ConversationSession',
      entityId: session.id,
      action: 'conversation.answer_processed',
      after: { turnId: turn.id, proposedFacts: result.facts.length, proposedRoles: result.roles.length, offTopic: result.offTopic, flagged: result.containsConfidentialData },
    });
  });
}

/** Content hash of a frozen profile (FLOW2 section 11: profile version content hash). */
export const profileHash = (p: ProfileData) => sha256(stableStringify(p));
