import type { Prisma } from '@prisma/client';
import {
  DEFAULT_EXPERIENCE_YEARS,
  DEFAULT_HOURS_PER_WEEK,
  levelRank,
  MATCH_WEIGHTS,
  type DemographicFilterInput,
  type DemographicType,
  type MatchBreakdown,
} from '@praxis/shared';
import type { Db, Tx } from '../db';
import { distanceKm, type GeoPoint, type Geocoder } from './geocoder';

/** Everything the matcher needs about a project, frozen at the time of the run. */
export interface MatchRequest {
  projectId: string;
  clientId: string;
  /** Template skills: a candidate's specialties must include at least one (the "SME profile covers the JD" rule). */
  templateSkills: string[];
  /** JD skills, scored for overlap. */
  jdSkills: string[];
  filters: DemographicFilterInput[];
  attributes: { key: string; label: string; type: DemographicType }[];
  /** Limit the run to these candidates (used to re-check eligibility at assignment time). */
  onlyCandidateIds?: string[];
}

export interface ScoredCandidate {
  candidateId: string;
  score: number;
  breakdown: MatchBreakdown;
}

export interface MatchRun {
  matches: ScoredCandidate[];
  /** Problems with the filters themselves, e.g. a city the geocoder does not know. */
  warnings: string[];
}

/** SPEC FLOW 2: kept behind an interface so scoring can later move to embeddings. */
export interface MatchService {
  findMatches(req: MatchRequest): Promise<MatchRun>;
}

export const ELIGIBLE_IDENTITY = ['VERIFIED', 'ALTERNATIVE_VERIFIED'] as const;
const INACTIVE_PROJECT = ['COMPLETED', 'CANCELLED'] as const;

const candidateSelect = {
  id: true,
  country: true,
  city: true,
  latitude: true,
  longitude: true,
  languages: true,
  specialties: true,
  skills: true,
  domainExperienceYears: true,
  educationLevel: true,
  hoursPerWeek: true,
  timezone: true,
  attributes: true,
  concurrentProjectLimit: true,
} satisfies Prisma.CandidateSelect;
type CandidateRow = Prisma.CandidateGetPayload<{ select: typeof candidateSelect }>;
type Lang = { language: string; level: string };

const lower = (xs: string[]) => new Set(xs.map((x) => x.trim().toLowerCase()));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Values the taxonomy's standard keys read from typed candidate columns; others come from `attributes`. */
function selectValues(c: CandidateRow, key: string): string[] {
  const fromColumn: Record<string, string | null> = { country: c.country, education_level: c.educationLevel, time_zone: c.timezone };
  if (key in fromColumn) return fromColumn[key] ? [fromColumn[key]!] : [];
  const v = (c.attributes as Record<string, unknown>)[key];
  return typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function numberValue(c: CandidateRow, key: string): number | null {
  if (key === 'domain_experience_years') return c.domainExperienceYears;
  if (key === 'availability_hours_week') return c.hoursPerWeek;
  const v = (c.attributes as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : null;
}
type Wanted = { language: string; minLevel: string };
/** How many wanted languages the candidate has at or above the minimum level. */
function languagesMet(c: CandidateRow, wanted: Wanted[]): number {
  const have = (c.languages as Lang[]) ?? [];
  return wanted.filter((w) => have.some((h) => h.language === w.language && levelRank(h.level) >= levelRank(w.minLevel))).length;
}

/** Rule-based v1 matcher (SPEC FLOW 2 matching logic; scoring definitions decided 26 Sep 2026). */
export class RuleBasedMatchService implements MatchService {
  constructor(
    private readonly db: Db | Tx,
    private readonly geocoder: Geocoder,
  ) {}

  async findMatches(req: MatchRequest): Promise<MatchRun> {
    const warnings: string[] = [];
    const typeOf = new Map(req.attributes.map((a) => [a.key, a]));

    // Geocode each radius filter once per run.
    const geo = new Map<string, GeoPoint | null>();
    for (const f of req.filters) {
      if (typeOf.get(f.attributeKey)?.type !== 'GEO_RADIUS') continue;
      const city = (f.values as { city?: string })?.city ?? '';
      const point = await this.geocoder.lookup(city);
      geo.set(f.attributeKey, point);
      if (!point) warnings.push(`"${city}" is not a city the geocoder knows, so no candidate can meet the ${typeOf.get(f.attributeKey)!.label} filter.`);
    }

    // Hard filters that SQL can apply cheaply: account, identity, required country.
    const requiredCountry = req.filters.find((f) => f.required && f.attributeKey === 'country' && typeOf.get('country')?.type === 'MULTI_SELECT');
    const rows = await this.db.candidate.findMany({
      where: {
        clientId: req.clientId,
        deletedAt: null,
        smeUser: { accountStatus: 'ACTIVE', identityStatus: { in: [...ELIGIBLE_IDENTITY] } },
        ...(requiredCountry ? { country: { in: requiredCountry.values as string[] } } : {}),
        ...(req.onlyCandidateIds ? { id: { in: req.onlyCandidateIds } } : {}),
      },
      select: candidateSelect,
    });

    // Exclusions: rejected for this project; at the concurrent-project limit elsewhere.
    const rejected = new Set(
      (await this.db.projectMatchRejection.findMany({ where: { projectId: req.projectId }, select: { candidateId: true } })).map((r) => r.candidateId),
    );
    const busy = await this.db.projectAssignment.groupBy({
      by: ['candidateId'],
      where: { releasedAt: null, projectId: { not: req.projectId }, project: { status: { notIn: [...INACTIVE_PROJECT] } } },
      _count: { _all: true },
    });
    const activeElsewhere = new Map(busy.map((b) => [b.candidateId, b._count._all]));
    const assignedHere = new Set(
      (await this.db.projectAssignment.findMany({ where: { projectId: req.projectId, releasedAt: null }, select: { candidateId: true } })).map((a) => a.candidateId),
    );

    const templateSkills = lower(req.templateSkills);
    const jdSkills = lower(req.jdSkills.length ? req.jdSkills : req.templateSkills);
    const required = req.filters.filter((f) => f.required);
    const preferred = req.filters.filter((f) => !f.required);
    const minYears = numberBound(req.filters, 'domain_experience_years') ?? DEFAULT_EXPERIENCE_YEARS;
    const minHours = numberBound(req.filters, 'availability_hours_week') ?? DEFAULT_HOURS_PER_WEEK;
    const langFilter = req.filters.find((f) => typeOf.get(f.attributeKey)?.type === 'LANGUAGE_PROFICIENCY');
    const wantedLangs = (langFilter?.values as Wanted[] | undefined) ?? [];

    const matches: ScoredCandidate[] = [];
    for (const c of rows) {
      if (rejected.has(c.id)) continue;
      if (!assignedHere.has(c.id) && (activeElsewhere.get(c.id) ?? 0) >= c.concurrentProjectLimit) continue;
      // The SME profile must cover the template's specialty.
      if (!c.specialties.some((s) => templateSkills.has(s.trim().toLowerCase()))) continue;
      if (!required.every((f) => this.meets(c, f, typeOf.get(f.attributeKey)?.type, geo))) continue;

      const have = lower([...c.skills, ...c.specialties]);
      const skills = jdSkills.size ? ([...jdSkills].filter((s) => have.has(s)).length / jdSkills.size) * MATCH_WEIGHTS.skills : 0;
      const experience = c.domainExperienceYears === null ? 0 : Math.min(1, c.domainExperienceYears / minYears) * MATCH_WEIGHTS.experience;
      const language = wantedLangs.length === 0 ? MATCH_WEIGHTS.language : (languagesMet(c, wantedLangs) / wantedLangs.length) * MATCH_WEIGHTS.language;
      const availability = c.hoursPerWeek === null ? 0 : Math.min(1, c.hoursPerWeek / minHours) * MATCH_WEIGHTS.availability;
      const preferredMet = preferred.filter((f) => this.meets(c, f, typeOf.get(f.attributeKey)?.type, geo)).map((f) => f.attributeKey);
      const preferredBonus = preferred.length ? (preferredMet.length / preferred.length) * MATCH_WEIGHTS.preferredBonus : 0;

      const breakdown: MatchBreakdown = {
        skills: round2(skills),
        experience: round2(experience),
        language: round2(language),
        availability: round2(availability),
        preferredBonus: round2(preferredBonus),
        preferredMet,
        preferredMissed: preferred.map((f) => f.attributeKey).filter((k) => !preferredMet.includes(k)),
      };
      matches.push({ candidateId: c.id, score: round2(skills + experience + language + availability + preferredBonus), breakdown });
    }
    // Highest score first; candidate id breaks ties so the order is stable between runs.
    matches.sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId));
    return { matches, warnings };
  }

  /** Whether a candidate meets one filter. Unknown candidate values never meet a filter. */
  private meets(c: CandidateRow, f: DemographicFilterInput, type: DemographicType | undefined, geo: Map<string, GeoPoint | null>): boolean {
    switch (type) {
      case 'SINGLE_SELECT':
      case 'MULTI_SELECT': {
        const want = new Set(f.values as string[]);
        return selectValues(c, f.attributeKey).some((v) => want.has(v));
      }
      case 'NUMBER_RANGE': {
        const v = numberValue(c, f.attributeKey);
        const { min, max } = (f.values ?? {}) as { min?: number; max?: number };
        if (v === null) return false;
        return (min === undefined || v >= min) && (max === undefined || v <= max);
      }
      case 'GEO_RADIUS': {
        const point = geo.get(f.attributeKey);
        if (!point || c.latitude === null || c.longitude === null) return false;
        return distanceKm(point, { latitude: c.latitude, longitude: c.longitude }) <= (f.values as { radiusKm: number }).radiusKm;
      }
      case 'LANGUAGE_PROFICIENCY': {
        const wanted = (f.values as Wanted[]) ?? [];
        return languagesMet(c, wanted) === wanted.length;
      }
      default:
        // An attribute that no longer exists in the taxonomy cannot be evaluated.
        return false;
    }
  }
}

function numberBound(filters: DemographicFilterInput[], key: string): number | null {
  const f = filters.find((x) => x.attributeKey === key);
  const min = (f?.values as { min?: number } | undefined)?.min;
  return typeof min === 'number' && min > 0 ? min : null;
}
