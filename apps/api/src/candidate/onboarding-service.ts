import type { Prisma } from '@prisma/client';
import {
  ConflictsAnswer,
  experienceDurations,
  identityEligible,
  ISO_COUNTRIES,
  ISO_LANGUAGES,
  ONBOARDING_ITEMS,
  PreferencesAnswer,
  ProfileData,
  TERMS_KEYS,
} from '@praxis/shared';
import type { Db, Tx } from '../db';
import { sha256 } from '../lib/crypto';
import { AppError, badRequest, notFound } from '../lib/errors';
import type { writeAudit } from '../platform/audit';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;
const COUNTRIES = new Set(ISO_COUNTRIES.map(([c]) => c));
const LANGUAGES = new Set(ISO_LANGUAGES.map(([c]) => c));

/** The newest published version of each required terms document. */
export async function currentTerms(tx: Db | Tx, clientId: string) {
  const docs = await tx.termsDocument.findMany({ where: { clientId }, orderBy: { version: 'desc' } });
  return TERMS_KEYS.map((key) => docs.find((d) => d.key === key) ?? null);
}

const PLACEHOLDER_TITLES: Record<(typeof TERMS_KEYS)[number], string> = {
  contributor: 'Contributor agreement',
  confidentiality_ip: 'Confidentiality and intellectual property',
  data_use: 'How your data is used',
};

/**
 * Version 1 of each terms document, marked as a placeholder. Legal text is outside this platform's spec, so an Admin
 * publishes the approved wording; until then production blocks onboarding (FLOW2 section 11). Create-only.
 */
export async function seedPlaceholderTerms(db: Db, clientId: string, publishedById: string) {
  for (const key of TERMS_KEYS) {
    const body = `PLACEHOLDER — not approved legal text. An Admin must publish the approved ${PLACEHOLDER_TITLES[key].toLowerCase()} before production use.`;
    const exists = await db.termsDocument.findFirst({ where: { clientId, key } });
    if (!exists) {
      await db.termsDocument.create({ data: { clientId, key, version: 1, title: PLACEHOLDER_TITLES[key], body, sha256: sha256(body), placeholder: true, publishedById } });
    }
  }
}

export async function onboardingView(tx: Db | Tx, enrollmentId: string, smeUserId: string) {
  const e = await tx.enrollment.findFirst({ where: { id: enrollmentId, smeUserId }, include: { onboarding: { include: { acknowledgements: true } }, qualificationScopes: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!e) throw notFound('Application not found');
  if (e.status !== 'SELECTED' || !e.onboarding) throw new AppError(409, 'NOT_SELECTED', 'Onboarding opens once you are selected for this pool.');
  const terms = await currentTerms(tx, e.clientId);
  const acks = new Map(e.onboarding.acknowledgements.map((a) => [a.itemKey, a]));
  return {
    enrollmentId: e.id,
    status: e.onboarding.status,
    blockReason: e.onboarding.blockReason,
    checklistVersion: e.onboarding.checklistVersion,
    scope: e.qualificationScopes[0] ?? null,
    items: ONBOARDING_ITEMS.map((i) => {
      const ack = acks.get(i.key);
      const doc = i.termsKey ? terms[TERMS_KEYS.indexOf(i.termsKey)] : null;
      // Newer terms must be accepted again; nothing is accepted automatically (FLOW2 section 11).
      const done = !!ack && (!doc || ack.termsHash === doc.sha256);
      return {
        ...i,
        done,
        data: ack?.data ?? null,
        terms: doc ? { title: doc.title, version: doc.version, body: doc.body, sha256: doc.sha256, placeholder: doc.placeholder } : null,
      };
    }),
  };
}

/** Records one checklist item. When every item is done, onboarding completes and the matching record is built. */
export async function acknowledge(
  tx: Tx,
  args: { enrollmentId: string; smeUserId: string; itemKey: string; termsHash?: string; data?: unknown; production: boolean },
  audit: Audit,
) {
  const view = await onboardingView(tx, args.enrollmentId, args.smeUserId);
  const item = view.items.find((i) => i.key === args.itemKey);
  if (!item) throw badRequest('Unknown checklist item');
  const e = await tx.enrollment.findUniqueOrThrow({ where: { id: args.enrollmentId }, include: { onboarding: true } });
  const checklist = e.onboarding!;
  let data: unknown = null;

  switch (item.kind) {
    case 'terms': {
      if (!item.terms) throw new AppError(409, 'TERMS_UNAVAILABLE', 'These terms have not been published yet. Please check back later.');
      if (args.production && item.terms.placeholder) {
        // Returned, not thrown, so the BLOCKED state commits with its audit event.
        await tx.onboardingChecklist.update({ where: { id: checklist.id }, data: { status: 'BLOCKED', blockReason: 'Approved contributor terms have not been published yet.' } });
        await audit({ entityType: 'OnboardingChecklist', entityId: checklist.id, action: 'onboarding.blocked', before: { status: checklist.status }, after: { status: 'BLOCKED', reason: 'TERMS_PLACEHOLDER', itemKey: item.key } });
        return { blocked: true as const, completed: false, error: 'TERMS_PLACEHOLDER', message: 'Approved terms are not available yet, so onboarding is paused. We will let you know.' };
      }
      if (args.termsHash !== item.terms.sha256) throw new AppError(409, 'TERMS_CHANGED', 'These terms have changed. Please read the current version.');
      break;
    }
    case 'conflicts': {
      const c = ConflictsAnswer.safeParse(args.data);
      if (!c.success) throw badRequest('Tell us whether you have relevant conflicts and confirm you may contribute original or permitted material.');
      if (c.data.hasConflicts && !c.data.details?.trim()) throw badRequest('Briefly describe the conflict (no confidential details).');
      data = c.data;
      await tx.conflictDeclaration.deleteMany({ where: { enrollmentId: e.id, reviewerId: null, resolvedAt: null } });
      if (c.data.hasConflicts) {
        await tx.conflictDeclaration.create({ data: { clientId: e.clientId, smeUserId: e.smeUserId, enrollmentId: e.id, employerDescription: c.data.details!.slice(0, 500), details: c.data.details } });
      }
      break;
    }
    case 'preferences': {
      const p = PreferencesAnswer.safeParse(args.data);
      if (!p.success) throw badRequest('Complete your country, languages, time zone and weekly hours.');
      if (!COUNTRIES.has(p.data.country)) throw badRequest('Choose a valid country.');
      if (p.data.languages.some((l) => !LANGUAGES.has(l.language))) throw badRequest('Choose valid languages.');
      data = p.data;
      break;
    }
    default:
      break;
  }

  await tx.onboardingAcknowledgement.upsert({
    where: { checklistId_itemKey: { checklistId: checklist.id, itemKey: item.key } },
    create: { clientId: e.clientId, checklistId: checklist.id, itemKey: item.key, termsHash: item.terms?.sha256 ?? null, data: data as Prisma.InputJsonValue },
    update: { termsHash: item.terms?.sha256 ?? null, data: data as Prisma.InputJsonValue, acknowledgedAt: new Date() },
  });
  await audit({ entityType: 'OnboardingChecklist', entityId: checklist.id, action: 'onboarding.item_completed', after: { itemKey: item.key, termsVersion: item.terms?.version ?? null } });

  const after = await onboardingView(tx, e.id, args.smeUserId);
  const complete = after.items.every((i) => i.done);
  if (complete && checklist.status !== 'COMPLETE') {
    await tx.onboardingChecklist.update({ where: { id: checklist.id }, data: { status: 'COMPLETE', completedAt: new Date(), blockReason: null } });
    await upsertMatchingRecord(tx, e.id);
    await audit({ entityType: 'OnboardingChecklist', entityId: checklist.id, action: 'onboarding.completed', before: { status: checklist.status }, after: { status: 'COMPLETE' } });
    return { blocked: false as const, completed: true, view: { ...after, status: 'COMPLETE' as const } };
  }
  if (!complete && checklist.status === 'NOT_STARTED') await tx.onboardingChecklist.update({ where: { id: checklist.id }, data: { status: 'IN_PROGRESS' } });
  return { blocked: false as const, completed: false, view: after };
}

/**
 * Builds the candidate's matching record (M3) from the approved scope, the confirmed profile and onboarding
 * preferences. Only eligibility fields; nothing identity-related.
 */
export async function upsertMatchingRecord(tx: Tx, enrollmentId: string) {
  const e = await tx.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    include: { onboarding: { include: { acknowledgements: true } }, qualificationScopes: { orderBy: { createdAt: 'desc' }, take: 1 }, profileVersion: true },
  });
  const prefs = PreferencesAnswer.parse(e.onboarding!.acknowledgements.find((a) => a.itemKey === 'preferences')!.data);
  const scope = e.qualificationScopes[0]!;
  const profile = ProfileData.parse(e.profileVersion!.data);
  const list = (k: string) => {
    const v = profile.fields[k];
    return v?.status === 'CONFIRMED' && Array.isArray(v.value) ? v.value : [];
  };
  const computed = experienceDurations(profile).domain.years;
  const selfReported = profile.fields.domain_years?.status === 'CONFIRMED' && typeof profile.fields.domain_years.value === 'number' ? profile.fields.domain_years.value : null;
  const specialties = [...new Set([...(scope.specialty ? [scope.specialty] : []), ...list('specialties'), ...list('compliance_areas')])];
  const data = {
    latestProfileVersionId: e.profileVersionId,
    country: prefs.country,
    languages: prefs.languages as unknown as Prisma.InputJsonValue,
    timezone: prefs.timezone,
    hoursPerWeek: prefs.hoursPerWeek,
    specialties,
    skills: [...new Set([...list('specialties'), ...list('compliance_areas'), ...list('tools_methods')])],
    jurisdictions: scope.jurisdictions,
    domainExperienceYears: computed > 0 ? computed : selfReported,
    lastValidatedAt: new Date(),
    poolStatus: 'SELECTED',
  };
  await tx.candidate.upsert({ where: { smeUserId: e.smeUserId }, create: { clientId: e.clientId, smeUserId: e.smeUserId, ...data }, update: data });
}

/**
 * Everything that must be current before a candidate may be proposed or accept an assignment (FLOW2 section 9):
 * account active, identity eligible, selected for this pool, scope not expired, onboarding complete with current terms,
 * no unresolved conflicts. Returns the qualification snapshot stored on the assignment.
 */
export async function assignmentEligibility(tx: Db | Tx, args: { smeUserId: string; projectId: string }) {
  const u = await tx.smeUser.findUnique({ where: { id: args.smeUserId } });
  if (!u || u.accountStatus !== 'ACTIVE') return { ok: false as const, reason: 'account not active' };
  if (!identityEligible(u.identityStatus)) return { ok: false as const, reason: 'identity not verified' };
  const e = await tx.enrollment.findFirst({
    where: { smeUserId: args.smeUserId, opportunity: { projectId: args.projectId } },
    include: { onboarding: true, qualificationScopes: { orderBy: { createdAt: 'desc' }, take: 1 }, profileVersion: true },
  });
  if (!e || e.status !== 'SELECTED') return { ok: false as const, reason: 'not selected for this pool' };
  const scope = e.qualificationScopes[0];
  if (!scope) return { ok: false as const, reason: 'no approved scope' };
  if (scope.expiresAt && scope.expiresAt <= new Date()) return { ok: false as const, reason: 'approved scope has expired and needs re-review' };
  if (e.onboarding?.status !== 'COMPLETE') return { ok: false as const, reason: 'onboarding not complete' };
  const view = await onboardingView(tx, e.id, args.smeUserId);
  if (view.items.some((i) => !i.done)) return { ok: false as const, reason: 'updated terms or checklist items need accepting' };
  const conflict = await tx.conflictDeclaration.findFirst({ where: { smeUserId: args.smeUserId, reviewerId: null, resolvedAt: null, OR: [{ enrollmentId: e.id }, { enrollmentId: null }] } });
  if (conflict) return { ok: false as const, reason: 'a declared conflict is not yet resolved' };
  return {
    ok: true as const,
    enrollmentId: e.id,
    snapshot: {
      scope: { domain: scope.domain, specialty: scope.specialty, jurisdictions: scope.jurisdictions, languages: scope.languages, contributionRoles: scope.contributionRoles, expiresAt: scope.expiresAt },
      selectionDecisionId: scope.selectionDecisionId,
      profileVersionId: e.profileVersionId,
      profileContentHash: e.profileVersion?.contentHash ?? null,
    },
  };
}
