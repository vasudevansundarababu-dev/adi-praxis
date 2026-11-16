import type { Project } from '@prisma/client';
import { normEmail, type DemographicFilterInput } from '@praxis/shared';
import type { Db, Tx } from '../db';

/**
 * D20 (owner, 16 Nov 2026): the Assign screen also lists people from the platform pool — anyone in this client with a
 * candidate record (onboarded SMEs, people assigned on other projects) — who meet the project's criteria and are free.
 *
 * Criteria are the project's own: its country filter (location), its minimum domain experience, and the template's
 * required skills (the project's JD skills). A value the person has not stated is shown as "not stated" and does not
 * exclude them; a stated value that misses a required filter does. Nothing here decides anything: the PM picks.
 */

const INACTIVE_PROJECT = ['COMPLETED', 'CANCELLED'] as const;

export interface PoolCriteria {
  /** ISO country codes the project asks for; null when it sets no location. */
  countries: string[] | null;
  countryRequired: boolean;
  /** Minimum years of domain experience; null when it sets none. */
  minYears: number | null;
  yearsRequired: boolean;
}

export interface CriterionMatch<T> {
  value: T | null;
  /** True met, false missed, null not stated by the person. */
  matched: boolean | null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The project's criteria: the demographics frozen at submit, else its live filters. */
export async function projectCriteria(tx: Db | Tx, p: Pick<Project, 'id' | 'demographicsSnapshot'>): Promise<PoolCriteria> {
  const snap = (p.demographicsSnapshot as { filters?: DemographicFilterInput[] } | null)?.filters;
  const filters = snap ?? ((await tx.projectDemographicFilter.findMany({ where: { projectId: p.id } })) as unknown as DemographicFilterInput[]);
  const country = filters.find((f) => f.attributeKey === 'country');
  const years = filters.find((f) => f.attributeKey === 'domain_experience_years');
  const min = (years?.values as { min?: unknown } | undefined)?.min;
  const countries = country ? strings(country.values).map((c) => c.toUpperCase()) : [];
  return {
    countries: countries.length ? countries : null,
    countryRequired: !!country && country.required !== false,
    minYears: typeof min === 'number' && min > 0 ? min : null,
    yearsRequired: !!years && years.required !== false,
  };
}

/**
 * Which of the project's skills the evidence mentions. Evidence is free text (assessment answers) and listed skills.
 * With no evidence at all the person is "not assessed" and every skill is null.
 */
export function skillMatch(skills: string[], evidence: unknown[]) {
  const values = evidence.filter((v): v is string => typeof v === 'string');
  const text = values.join('\n').toLowerCase();
  const assessed = values.length > 0;
  return { assessed, matchingSkills: skills.map((skill) => ({ skill, matched: assessed ? text.includes(skill.toLowerCase()) : null })) };
}

export function locationMatch(c: PoolCriteria, country: string | null): CriterionMatch<string> | null {
  if (!c.countries) return null;
  return { value: country, matched: country ? c.countries.includes(country.toUpperCase()) : null };
}

export function experienceMatch(c: PoolCriteria, years: number | null): CriterionMatch<number> | null {
  if (c.minYears === null) return null;
  return { value: years, matched: years === null ? null : years >= c.minYears };
}

/** Splits a display name into first and last; the last name may be empty. */
export function splitName(display: string | null, email: string) {
  const parts = (display ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: email.split('@')[0] ?? email, lastName: '' };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

export interface PoolPerson {
  candidateId: string;
  smeUserId: string;
  firstName: string;
  lastName: string;
  email: string;
  assessed: boolean;
  matchingSkills: { skill: string; matched: boolean | null }[];
  location: CriterionMatch<string> | null;
  experience: CriterionMatch<number> | null;
  /** Other open projects the person is on, and their limit. */
  activeProjects: number;
  projectLimit: number;
}

/**
 * Available pool people for the project, best match first. Excluded: anyone already on this project (any Sourcing
 * profile or place here, so they are listed once, by Sourcing), anyone at their concurrent-project limit, and anyone
 * whose stated location, experience or skills miss the project's requirements.
 *
 * `onlyCandidateId` checks one person at assignment time; `includeOnProject` then skips the "already on this project"
 * exclusion (the one-role-per-project rule is checked by the assignment itself).
 */
export async function poolPeople(tx: Db | Tx, p: Pick<Project, 'id' | 'clientId' | 'demographicsSnapshot'>, skills: string[], o: { onlyCandidateId?: string; includeOnProject?: boolean } = {}) {
  const criteria = await projectCriteria(tx, p);
  const candidates = await tx.candidate.findMany({
    where: {
      clientId: p.clientId,
      deletedAt: null,
      smeUser: { accountStatus: 'ACTIVE', anonymizedAt: null, contactEmail: { not: null } },
      ...(o.onlyCandidateId ? { id: o.onlyCandidateId } : {}),
    },
    include: { smeUser: { select: { id: true, displayName: true, contactEmail: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!candidates.length) return { criteria, items: [] as PoolPerson[] };

  const smeUserIds = candidates.map((c) => c.smeUserId);
  const emails = [...new Set(candidates.map((c) => normEmail(c.smeUser.contactEmail!)))];
  // Every Sourcing profile of these people in the client: names, assessment evidence, and where they are placed.
  const sourced = await tx.sourcedPerson.findMany({
    where: { clientId: p.clientId, OR: [{ smeUserId: { in: smeUserIds } }, { emailNorm: { in: emails } }] },
    include: { project: { select: { status: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  const assignments = await tx.projectAssignment.findMany({
    where: { candidateId: { in: candidates.map((c) => c.id) }, releasedAt: null },
    select: { candidateId: true, projectId: true, project: { select: { status: true } } },
  });
  const active = (status: string) => !(INACTIVE_PROJECT as readonly string[]).includes(status);

  const items: PoolPerson[] = [];
  for (const c of candidates) {
    const email = normEmail(c.smeUser.contactEmail!);
    const mine = sourced.filter((s) => s.smeUserId === c.smeUserId || s.emailNorm === email);
    const placed = assignments.filter((a) => a.candidateId === c.id);
    const onProject = mine.some((s) => s.projectId === p.id) || placed.some((a) => a.projectId === p.id);
    if (onProject && !o.includeOnProject) continue;
    // Open projects elsewhere: a place (earlier flow) or an assignment by a PM (new flow).
    const elsewhere = new Set([
      ...placed.filter((a) => a.projectId !== p.id && active(a.project.status)).map((a) => a.projectId),
      ...mine.filter((s) => s.projectId !== p.id && s.assignedAt && !s.releasedAt && active(s.project.status)).map((s) => s.projectId),
    ]);
    if (elsewhere.size >= c.concurrentProjectLimit) continue;

    const location = locationMatch(criteria, c.country);
    const experience = experienceMatch(criteria, c.domainExperienceYears);
    if (criteria.countryRequired && location?.matched === false) continue;
    if (criteria.yearsRequired && experience?.matched === false) continue;
    const evidence = [...c.skills, ...c.specialties, ...mine.flatMap((s) => Object.values((s.assessment ?? {}) as Record<string, unknown>))];
    const m = skillMatch(skills, evidence);
    if (m.assessed && skills.length && !m.matchingSkills.some((x) => x.matched)) continue;

    const named = mine[0];
    const name = named ? { firstName: named.firstName, lastName: named.lastName } : splitName(c.smeUser.displayName, email);
    items.push({ candidateId: c.id, smeUserId: c.smeUserId, ...name, email, ...m, location, experience, activeProjects: elsewhere.size, projectLimit: c.concurrentProjectLimit });
  }
  const score = (x: PoolPerson) => x.matchingSkills.filter((s) => s.matched).length + (x.location?.matched ? 1 : 0) + (x.experience?.matched ? 1 : 0);
  items.sort((a, b) => score(b) - score(a) || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`) || a.candidateId.localeCompare(b.candidateId));
  return { criteria, items };
}
