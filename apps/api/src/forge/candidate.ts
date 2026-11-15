import {
  normEmail,
  smeTaskStatus,
  SYNTHETIC_ONLY_PURPOSE,
  SYNTHETIC_ONLY_VERSION,
  TERMS_KEYS,
  termsConsentPurpose,
  type ForgeAuthorTask,
  type ForgeTermsAcceptRequest,
  type ForgeTermsView,
} from '@praxis/shared';
import type { CandidateActor } from '../auth/actor';
import { currentTerms } from '../candidate/onboarding-service';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import { AppError } from '../lib/errors';
import type { AuditInput } from '../platform/audit';
import { EXPERT_TASK_TYPES } from '../tasks/task-service';
import { lastChange } from './review';
import { taskLabel } from './sourcing';

type Audit = (i: AuditInput) => Promise<void>;

/**
 * MVP1 step 3 (docs/design/PROJECT-SCREEN-DESIGN.md, "Candidate app for MVP1"): claiming the account a PM or Admin
 * pre-created, the one-time Before you start screen (contributor terms and synthetic data only), and Home.
 */

const TERMS_PURPOSES = [...TERMS_KEYS.map(termsConsentPurpose), SYNTHETIC_ONLY_PURPOSE];

/** Placeholder terms are refused where onboarding refuses them: live identity required, or a production build (not demo). */
export const placeholderTermsRefused = (config: Pick<Config, 'requireLiveIdentity' | 'NODE_ENV' | 'appEnv'>) =>
  config.requireLiveIdentity || (config.NODE_ENV === 'production' && config.appEnv !== 'demo');

/** Whether the person accepted every current terms document (by its content hash) and confirmed synthetic data only. */
export async function forgeTermsAccepted(tx: Db | Tx, smeUserId: string, clientId: string): Promise<boolean> {
  const terms = await currentTerms(tx, clientId);
  if (terms.some((t) => !t)) return false;
  const consents = await tx.consent.findMany({ where: { smeUserId, clientId, revokedAt: null, purpose: { in: TERMS_PURPOSES } }, select: { purpose: true, version: true } });
  const has = (purpose: string, version: string) => consents.some((c) => c.purpose === purpose && c.version === version);
  return terms.every((t) => has(termsConsentPurpose(t!.key as (typeof TERMS_KEYS)[number]), t!.sha256)) && has(SYNTHETIC_ONLY_PURPOSE, SYNTHETIC_ONLY_VERSION);
}

export async function forgeTermsView(tx: Db | Tx, actor: CandidateActor): Promise<ForgeTermsView> {
  const terms = await currentTerms(tx, actor.clientId);
  return {
    terms: terms.map((t, i) => (t ? { key: TERMS_KEYS[i]!, title: t.title, body: t.body, version: t.version, sha256: t.sha256, placeholder: t.placeholder } : null)),
    accepted: await forgeTermsAccepted(tx, actor.smeUserId, actor.clientId),
  };
}

/** Records the acceptance: one Consent per terms document (version = its hash) and one for synthetic data only. */
export async function acceptForgeTerms(tx: Tx, actor: CandidateActor, body: ForgeTermsAcceptRequest, refusePlaceholder: boolean, audit: Audit) {
  // One acceptance at a time per person, so a double click never records twice.
  await tx.$executeRaw`SELECT 1 FROM "SmeUser" WHERE id = ${actor.smeUserId}::uuid FOR UPDATE`;
  const terms = await currentTerms(tx, actor.clientId);
  if (terms.some((t) => !t)) throw new AppError(409, 'TERMS_UNAVAILABLE', 'The contributor terms have not been published yet. Please check back later.');
  if (refusePlaceholder && terms.some((t) => t!.placeholder)) throw new AppError(409, 'TERMS_PLACEHOLDER', 'Approved terms are not available yet. Please check back later.');
  if (terms.some((t, i) => body.hashes[TERMS_KEYS[i]!] !== t!.sha256)) throw new AppError(409, 'TERMS_CHANGED', 'These terms have changed. Please read the current version.');

  const existing = await tx.consent.findMany({ where: { smeUserId: actor.smeUserId, clientId: actor.clientId, revokedAt: null, purpose: { in: TERMS_PURPOSES } } });
  const wanted = [...terms.map((t, i) => ({ purpose: termsConsentPurpose(TERMS_KEYS[i]!), version: t!.sha256 })), { purpose: SYNTHETIC_ONLY_PURPOSE, version: SYNTHETIC_ONLY_VERSION }];
  const missing = wanted.filter((w) => !existing.some((c) => c.purpose === w.purpose && c.version === w.version));
  if (missing.length) await tx.consent.createMany({ data: missing.map((m) => ({ clientId: actor.clientId, smeUserId: actor.smeUserId, ...m })) });
  await audit({
    entityType: 'SmeUser',
    entityId: actor.smeUserId,
    action: 'candidate.terms_accepted',
    after: { terms: terms.map((t) => ({ key: t!.key, version: t!.version, sha256: t!.sha256 })), syntheticOnly: true, recorded: missing.length, alreadyAccepted: missing.length === 0 },
  });
  return { accepted: true };
}

export const termsRequired = () => new AppError(409, 'TERMS_REQUIRED', 'Accept the contributor terms first.', { href: '/welcome' });

export async function requireForgeTerms(tx: Db | Tx, actor: CandidateActor) {
  if (!(await forgeTermsAccepted(tx, actor.smeUserId, actor.clientId))) throw termsRequired();
}

/** Home: the tasks assigned to this person as SME by a PM or Admin (projects where they are directly assigned). */
export async function forgeAuthorTasks(db: Db | Tx, actor: CandidateActor): Promise<ForgeAuthorTask[]> {
  const candidate = await db.candidate.findUnique({ where: { smeUserId: actor.smeUserId }, select: { id: true } });
  if (!candidate) return [];
  const places = await db.sourcedPerson.findMany({ where: { clientId: actor.clientId, smeUserId: actor.smeUserId, role: 'SME', assignedAt: { not: null }, releasedAt: null }, select: { projectId: true } });
  if (!places.length) return [];
  const tasks = await db.taskInstance.findMany({
    where: { clientId: actor.clientId, assignedToId: candidate.id, projectId: { in: [...new Set(places.map((p) => p.projectId))] }, taskType: EXPERT_TASK_TYPES },
    include: { project: { select: { name: true } }, slot: { select: { position: true } }, reviews: { select: { createdAt: true, decision: true, comments: true }, orderBy: { createdAt: 'desc' } } },
    orderBy: [{ projectId: 'asc' }, { slot: { position: 'asc' } }, { createdAt: 'asc' }],
  });
  return tasks.map((t) => {
    const sentBack = t.status === 'REWORK' ? t.reviews.find((r) => r.decision === 'REWORK') : undefined;
    return {
      taskId: t.id,
      label: taskLabel(t),
      projectName: t.project.name,
      status: smeTaskStatus(t.status),
      date: lastChange(t, t.reviews.map((r) => r.createdAt)),
      reworkComments: Array.isArray(sentBack?.comments) ? sentBack.comments.length : 0,
    };
  });
}

/**
 * The account to use at first sign-in in the new flow (owner's design: the email the PM or Admin uploaded in Sourcing
 * is the sign-in). Only for a verified Google email that matches a sourced SME or Reviewer in this client:
 * - `link`: the person already has a pre-created account with no sign-in identity; the new identity is linked to it.
 * - `create`: no account yet; a new one is created and every sourced row with that email points at it.
 * - null: no match, or the matched account already has a sign-in identity (never taken over); a new account as today.
 */
export async function claimTarget(tx: Tx, clientId: string, email: string): Promise<{ kind: 'link'; smeUserId: string; sourcedPersonIds: string[] } | { kind: 'create'; sourcedPersonIds: string[] } | null> {
  const people = await tx.sourcedPerson.findMany({ where: { clientId, emailNorm: normEmail(email), role: { in: ['SME', 'REVIEWER'] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (!people.length) return null;
  const ids = [...new Set(people.map((p) => p.smeUserId).filter((x): x is string => !!x))];
  if (!ids.length) return { kind: 'create', sourcedPersonIds: people.map((p) => p.id) };
  if (ids.length > 1) return null;
  const smeUserId = ids[0]!;
  // Lock the pre-created account so two first sign-ins with the same email never both link to it.
  await tx.$executeRaw`SELECT 1 FROM "SmeUser" WHERE id = ${smeUserId}::uuid FOR UPDATE`;
  const u = await tx.smeUser.findFirst({ where: { id: smeUserId, clientId, anonymizedAt: null }, include: { _count: { select: { providerIdentities: true } } } });
  if (!u || u._count.providerIdentities > 0) return null;
  return { kind: 'link', smeUserId, sourcedPersonIds: people.map((p) => p.id) };
}
