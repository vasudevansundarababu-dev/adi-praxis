import { z } from 'zod';
import { IANA_TIME_ZONES, ISO_COUNTRIES, ISO_LANGUAGES, TIME_ZONE_RENAMES } from './taxonomy-data';

/** The current IANA name for a time zone (Asia/Calcutta → Asia/Kolkata); unknown names pass through. */
export const canonicalTimeZone = (z: string) => TIME_ZONE_RENAMES[z] ?? z;

/**
 * Admin-managed demographic taxonomy (SPEC: FLOW 1 step 4). Each attribute has a type that fixes the shape of its
 * allowed values and of the filters a project may set on it.
 */
export const DEMOGRAPHIC_TYPES = ['SINGLE_SELECT', 'MULTI_SELECT', 'NUMBER_RANGE', 'GEO_RADIUS', 'LANGUAGE_PROFICIENCY'] as const;
export type DemographicType = (typeof DEMOGRAPHIC_TYPES)[number];

export const FILTER_OPERATORS = ['IN', 'GTE', 'LTE', 'BETWEEN', 'WITHIN_RADIUS'] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

const Option = z.object({ value: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(200) });
export type Option = z.infer<typeof Option>;

const uniqueValues = (opts: Option[], ctx: z.RefinementCtx, path: (string | number)[] = []) => {
  const seen = new Set<string>();
  opts.forEach((o, i) => {
    if (seen.has(o.value)) ctx.addIssue({ code: 'custom', path: [...path, i, 'value'], message: `Duplicate value "${o.value}"` });
    seen.add(o.value);
  });
};

export const SelectAllowed = z.array(Option).min(1).max(1000).superRefine((o, ctx) => uniqueValues(o, ctx));
export const RangeAllowed = z
  .object({ min: z.number(), max: z.number(), unit: z.string().trim().min(1).max(40) })
  .refine((r) => r.min < r.max, 'min must be below max');
export const GeoAllowed = z.object({ maxRadiusKm: z.number().positive().max(20_000) });
export const LanguageAllowed = z
  .object({ languages: z.array(Option).min(1).max(1000), levels: z.array(Option).min(1).max(20) })
  .superRefine((v, ctx) => {
    uniqueValues(v.languages, ctx, ['languages']);
    uniqueValues(v.levels, ctx, ['levels']);
  });

export const ALLOWED_VALUES_SCHEMA = {
  SINGLE_SELECT: SelectAllowed,
  MULTI_SELECT: SelectAllowed,
  NUMBER_RANGE: RangeAllowed,
  GEO_RADIUS: GeoAllowed,
  LANGUAGE_PROFICIENCY: LanguageAllowed,
} as const;

export const CreateDemographicAttributeRequest = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, 'Use lower_snake_case').max(60),
    label: z.string().trim().min(1).max(100),
    type: z.enum(DEMOGRAPHIC_TYPES),
    allowedValues: z.unknown(),
  })
  .superRefine((a, ctx) => {
    const r = ALLOWED_VALUES_SCHEMA[a.type].safeParse(a.allowedValues);
    if (!r.success) {
      for (const i of r.error.issues) ctx.addIssue({ ...i, path: ['allowedValues', ...i.path] });
    }
  });
export type CreateDemographicAttributeRequest = z.infer<typeof CreateDemographicAttributeRequest>;

export const DemographicAttributeDto = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  type: z.enum(DEMOGRAPHIC_TYPES),
  allowedValues: z.unknown(),
});
export type DemographicAttributeDto = z.infer<typeof DemographicAttributeDto>;

/** A project's filter on one attribute (SPEC: "Each filter marked required or preferred"). */
export const DemographicFilterInput = z.object({
  attributeKey: z.string().trim().min(1).max(60),
  operator: z.enum(FILTER_OPERATORS),
  values: z.unknown(),
  required: z.boolean(),
});
export type DemographicFilterInput = z.infer<typeof DemographicFilterInput>;

/** Checks a filter against its attribute. Returns human-readable problems (empty when valid). */
export function filterProblems(
  attr: { key: string; label: string; type: DemographicType; allowedValues: unknown },
  f: DemographicFilterInput,
): string[] {
  const p = (m: string) => [`${attr.label}: ${m}`];
  switch (attr.type) {
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT': {
      if (f.operator !== 'IN') return p('use "is one of"');
      const allowed = new Set((SelectAllowed.safeParse(attr.allowedValues).data ?? []).map((o) => o.value));
      const v = z.array(z.string()).min(1).safeParse(f.values);
      if (!v.success) return p('choose at least one value');
      if (attr.type === 'SINGLE_SELECT' && v.data.length > 1) return p('choose one value');
      const bad = v.data.filter((x) => !allowed.has(x));
      return bad.length ? p(`unknown value(s) ${bad.join(', ')}`) : [];
    }
    case 'NUMBER_RANGE': {
      const r = RangeAllowed.safeParse(attr.allowedValues).data;
      const v = z.object({ min: z.number().optional(), max: z.number().optional() }).safeParse(f.values);
      if (!r || !v.success) return p('enter a number range');
      const { min, max } = v.data;
      const need = { GTE: min !== undefined, LTE: max !== undefined, BETWEEN: min !== undefined && max !== undefined };
      if (!(f.operator in need) || !need[f.operator as keyof typeof need]) return p('enter the bound(s) for this comparison');
      for (const x of [min, max]) if (x !== undefined && (x < r.min || x > r.max)) return p(`values must be between ${r.min} and ${r.max} ${r.unit}`);
      if (min !== undefined && max !== undefined && min > max) return p('minimum is above maximum');
      return [];
    }
    case 'GEO_RADIUS': {
      if (f.operator !== 'WITHIN_RADIUS') return p('use "within radius"');
      const g = GeoAllowed.safeParse(attr.allowedValues).data;
      const v = z.object({ city: z.string().trim().min(1).max(200), radiusKm: z.number().positive() }).safeParse(f.values);
      if (!g || !v.success) return p('enter a city and a radius in km');
      return v.data.radiusKm > g.maxRadiusKm ? p(`radius can be at most ${g.maxRadiusKm} km`) : [];
    }
    case 'LANGUAGE_PROFICIENCY': {
      if (f.operator !== 'IN') return p('use "is one of"');
      const a = LanguageAllowed.safeParse(attr.allowedValues).data;
      const v = z.array(z.object({ language: z.string(), minLevel: z.string() })).min(1).safeParse(f.values);
      if (!a || !v.success) return p('choose at least one language with a minimum level');
      const langs = new Set(a.languages.map((o) => o.value));
      const levels = new Set(a.levels.map((o) => o.value));
      const bad = v.data.filter((x) => !langs.has(x.language) || !levels.has(x.minLevel));
      return bad.length ? p(`unknown language or level: ${bad.map((b) => `${b.language}/${b.minLevel}`).join(', ')}`) : [];
    }
  }
}

// ───────────── Seed taxonomy (SPEC FLOW 1 step 4; decided 26 Sep 2026: standard lists) ─────────────
// No age band: FLOW2-SME section 9 forbids matching on age, and 18+ is enforced at candidate sign-up instead.

const opts = (pairs: readonly (readonly [string, string])[]): Option[] => pairs.map(([value, label]) => ({ value, label }));

/** CEFR levels in ascending order, plus native/bilingual which CEFR itself does not define. */
export const CEFR_LEVELS: Option[] = [
  { value: 'A1', label: 'A1 Beginner' },
  { value: 'A2', label: 'A2 Elementary' },
  { value: 'B1', label: 'B1 Intermediate' },
  { value: 'B2', label: 'B2 Upper intermediate' },
  { value: 'C1', label: 'C1 Advanced' },
  { value: 'C2', label: 'C2 Proficient' },
  { value: 'NATIVE', label: 'Native or bilingual' },
];

/** ISCED 2011 levels. */
export const ISCED_LEVELS: Option[] = opts([
  ['ISCED_0', 'Early childhood education'],
  ['ISCED_1', 'Primary education'],
  ['ISCED_2', 'Lower secondary education'],
  ['ISCED_3', 'Upper secondary education'],
  ['ISCED_4', 'Post-secondary non-tertiary education'],
  ['ISCED_5', 'Short-cycle tertiary education'],
  ['ISCED_6', "Bachelor's or equivalent"],
  ['ISCED_7', "Master's or equivalent"],
  ['ISCED_8', 'Doctoral or equivalent'],
]);

export const SEED_DEMOGRAPHIC_ATTRIBUTES: CreateDemographicAttributeRequest[] = [
  { key: 'country', label: 'Country / region', type: 'MULTI_SELECT', allowedValues: opts(ISO_COUNTRIES) },
  { key: 'city_radius', label: 'City or radius', type: 'GEO_RADIUS', allowedValues: { maxRadiusKm: 500 } },
  {
    key: 'languages',
    label: 'Languages and proficiency',
    type: 'LANGUAGE_PROFICIENCY',
    allowedValues: { languages: opts(ISO_LANGUAGES), levels: CEFR_LEVELS },
  },
  { key: 'education_level', label: 'Education level', type: 'MULTI_SELECT', allowedValues: ISCED_LEVELS },
  { key: 'domain_experience_years', label: 'Domain experience', type: 'NUMBER_RANGE', allowedValues: { min: 0, max: 50, unit: 'years' } },
  { key: 'availability_hours_week', label: 'Availability', type: 'NUMBER_RANGE', allowedValues: { min: 1, max: 60, unit: 'hours/week' } },
  { key: 'time_zone', label: 'Time zone', type: 'MULTI_SELECT', allowedValues: IANA_TIME_ZONES.map((z) => ({ value: z, label: z })) },
];

/** Rank of a language level for "at least" comparisons; -1 if unknown. */
export const levelRank = (level: string) => CEFR_LEVELS.findIndex((l) => l.value === level);
