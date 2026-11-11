import { z } from 'zod';
import { CEFR_LEVELS, ISCED_LEVELS, type DemographicFilterInput } from './taxonomy';

/**
 * Generated job descriptions (owner, 12 Nov 2026). When a PM creates a project, Praxis writes the JD from the template:
 * the template's skills are the JD's mandatory skills, and the project's demographic filters give the demographic and
 * education profile. When the review route needs an Expert (SME -> Expert -> PM), Praxis also writes a reviewer JD with
 * the same skills and more years of experience. Both JDs then go to recruitment. The PM can edit the title, the
 * responsibilities, the pay and the location, and can add skills, but cannot remove the template's mandatory skills.
 */

export const JD_ROLES = ['AUTHOR', 'REVIEWER'] as const;
export type JdRole = (typeof JD_ROLES)[number];
export const JD_ROLE_LABELS: Record<JdRole, string> = { AUTHOR: 'Task author (SME)', REVIEWER: 'Expert reviewer' };

/** Defaults when the project sets no experience or education filter (DECISIONS.md, 12 Nov 2026). */
export const DEFAULT_AUTHOR_EXPERIENCE_YEARS = 5;
export const REVIEWER_EXTRA_EXPERIENCE_YEARS = 5;
export const DEFAULT_EDUCATION_LEVEL = 'ISCED_6';

/** One line of the JD's demographic profile, e.g. "Country / region: United Kingdom, Ireland (required)". */
export const JdProfileLine = z.object({ key: z.string(), label: z.string(), text: z.string(), required: z.boolean() });
export type JdProfileLine = z.infer<typeof JdProfileLine>;

export interface GeneratedJd {
  role: JdRole;
  title: string;
  responsibilities: string;
  /** The template's skills, all mandatory. */
  mandatorySkills: string[];
  minExperienceYears: number;
  /** Minimum ISCED level, e.g. ISCED_6. */
  educationLevel: string;
  demographicProfile: JdProfileLine[];
}

export interface JdGeneratorInput {
  workflowName: string;
  domainName: string;
  primaryWork?: string | null;
  skills: string[];
  taskMode: string;
  reviewRoute?: string | null;
  tptMinutes?: number | null;
  filters: DemographicFilterInput[];
  attributes: { key: string; label: string; type: string; allowedValues?: unknown }[];
}

const uniq = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.map((s) => s.trim()).filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
};

export const educationLabel = (level: string) => ISCED_LEVELS.find((l) => l.value === level)?.label ?? level;
const iscedRank = (level: string) => ISCED_LEVELS.findIndex((l) => l.value === level);

/** Minimum years from the project's domain-experience filter, else the default. */
export function experienceYears(filters: DemographicFilterInput[]): number {
  const f = filters.find((x) => x.attributeKey === 'domain_experience_years');
  const min = (f?.values as { min?: number } | undefined)?.min;
  return typeof min === 'number' && min > 0 ? min : DEFAULT_AUTHOR_EXPERIENCE_YEARS;
}

/** The lowest education level the project accepts, else the default (Bachelor's or equivalent). */
export function minimumEducation(filters: DemographicFilterInput[]): string {
  const f = filters.find((x) => x.attributeKey === 'education_level');
  const values = Array.isArray(f?.values) ? (f!.values as unknown[]).filter((v): v is string => typeof v === 'string' && iscedRank(v) >= 0) : [];
  if (!values.length) return DEFAULT_EDUCATION_LEVEL;
  return values.reduce((lo, v) => (iscedRank(v) < iscedRank(lo) ? v : lo));
}

function optionLabel(allowed: unknown, value: string): string {
  const list = Array.isArray(allowed) ? (allowed as { value?: string; label?: string }[]) : [];
  return list.find((o) => o.value === value)?.label ?? value;
}

/** Plain-language lines for every demographic filter except experience and education (they have their own JD fields). */
export function demographicProfile(filters: DemographicFilterInput[], attributes: JdGeneratorInput['attributes']): JdProfileLine[] {
  const byKey = new Map(attributes.map((a) => [a.key, a]));
  const lines: JdProfileLine[] = [];
  for (const f of filters) {
    if (f.attributeKey === 'domain_experience_years' || f.attributeKey === 'education_level') continue;
    const a = byKey.get(f.attributeKey);
    const label = a?.label ?? f.attributeKey;
    const v = f.values as unknown;
    let text = '';
    if (a?.type === 'LANGUAGE_PROFICIENCY' && Array.isArray(v)) {
      const langs = (a.allowedValues as { languages?: { value: string; label: string }[] } | undefined)?.languages ?? [];
      text = (v as { language: string; minLevel: string }[])
        .map((x) => `${langs.find((l) => l.value === x.language)?.label ?? x.language} (${CEFR_LEVELS.find((l) => l.value === x.minLevel)?.label ?? x.minLevel} or above)`)
        .join(', ');
    } else if (a?.type === 'GEO_RADIUS' && v && typeof v === 'object') {
      const g = v as { city?: string; radiusKm?: number };
      text = `within ${g.radiusKm} km of ${g.city}`;
    } else if (a?.type === 'NUMBER_RANGE' && v && typeof v === 'object') {
      const r = v as { min?: number; max?: number };
      const unit = (a.allowedValues as { unit?: string } | undefined)?.unit ?? '';
      text = r.min !== undefined && r.max !== undefined ? `${r.min}–${r.max} ${unit}` : r.min !== undefined ? `at least ${r.min} ${unit}` : `at most ${r.max} ${unit}`;
    } else if (Array.isArray(v)) {
      text = (v as string[]).map((x) => optionLabel(a?.allowedValues, x)).join(', ');
    } else continue;
    lines.push({ key: f.attributeKey, label, text: text.trim(), required: f.required });
  }
  return lines;
}

export const needsReviewerJd = (input: { taskMode: string; reviewRoute?: string | null }) => input.taskMode === 'AUTHORING' && input.reviewRoute === 'SME_EXPERT_PM';

function authorResponsibilities(i: JdGeneratorInput): string {
  const work = i.taskMode === 'AUTHORING' ? 'Author realistic, fully synthetic' : i.taskMode === 'ANNOTATION' ? 'Annotate' : 'Review agent runs on';
  return [
    `${work} ${i.workflowName} tasks in the ${i.domainName} domain, used to train and evaluate AI agents.`,
    i.primaryWork ? `The work: ${i.primaryWork.trim()}` : '',
    i.taskMode === 'AUTHORING'
      ? 'For each task, write the case and its evidence, the expected work, the allowed outcomes, the reference answer and the rubric; run the checks; and revise the task when a reviewer returns it.'
      : '',
    i.tptMinutes ? `About ${i.tptMinutes} minutes per task (a planning target, not a deadline).` : '',
    'All task content is synthetic: never use real customer, employer or personal data.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function reviewerResponsibilities(i: JdGeneratorInput): string {
  return [
    `Review ${i.workflowName} tasks written by subject-matter experts in the ${i.domainName} domain before the project manager approves them.`,
    'Check that each case is realistic and fully synthetic, that the expected work follows the project policies, and that the reference answer and the rubric are correct and complete.',
    'Approve, return with feedback, reject with a reason, or make small edits with a reason. Changes to the rubric or the reference answer always go back to the author. The project manager makes the final approval.',
    'All task content is synthetic: never use real customer, employer or personal data.',
  ].join('\n\n');
}

/** The author JD, plus the reviewer JD when the review route needs an Expert. Deterministic: no model is involved. */
export function generateJobDescriptions(i: JdGeneratorInput): { author: GeneratedJd; reviewer: GeneratedJd | null } {
  const mandatorySkills = uniq(i.skills);
  const years = experienceYears(i.filters);
  const educationLevel = minimumEducation(i.filters);
  const profile = demographicProfile(i.filters, i.attributes);
  const author: GeneratedJd = {
    role: 'AUTHOR',
    title: `${i.workflowName} ${i.taskMode === 'AUTHORING' ? 'task author' : i.taskMode === 'ANNOTATION' ? 'annotator' : 'reviewer'} (${i.domainName})`,
    responsibilities: authorResponsibilities(i),
    mandatorySkills,
    minExperienceYears: years,
    educationLevel,
    demographicProfile: profile,
  };
  const reviewer: GeneratedJd | null = needsReviewerJd(i)
    ? {
        role: 'REVIEWER',
        title: `${i.workflowName} expert reviewer (${i.domainName})`,
        responsibilities: reviewerResponsibilities(i),
        mandatorySkills,
        minExperienceYears: years + REVIEWER_EXTRA_EXPERIENCE_YEARS,
        educationLevel,
        demographicProfile: profile,
      }
    : null;
  return { author, reviewer };
}

/** What a JD asks for, in the words a candidate reads (job post, requisition, review step). */
export function jdRequirementLines(jd: { skills: string[]; mandatorySkills?: string[]; minExperienceYears?: number | null; educationLevel?: string | null; demographicProfile?: JdProfileLine[] }): {
  required: string[];
  preferred: string[];
} {
  const mandatory = new Set((jd.mandatorySkills ?? []).map((s) => s.toLowerCase()));
  const required: string[] = [];
  const preferred: string[] = [];
  for (const s of jd.skills) (mandatory.has(s.toLowerCase()) ? required : preferred).push(`Hands-on experience with ${s}`);
  if (jd.minExperienceYears) required.push(`At least ${jd.minExperienceYears} years of experience in the domain`);
  if (jd.educationLevel) required.push(`Education: ${educationLabel(jd.educationLevel)} or higher (or equivalent professional experience)`);
  for (const l of jd.demographicProfile ?? []) (l.required ? required : preferred).push(`${l.label}: ${l.text}`);
  return { required, preferred };
}

/** Problems with a project's JDs that block submit. */
export function jdProblems(
  templateSkills: string[],
  input: { taskMode: string; reviewRoute?: string | null },
  author: { skills: string[]; minExperienceYears?: number | null } | null,
  reviewer: { skills: string[]; minExperienceYears?: number | null } | null,
): string[] {
  const problems: string[] = [];
  const missing = (jd: { skills: string[] }) => {
    const have = new Set(jd.skills.map((s) => s.trim().toLowerCase()));
    return uniq(templateSkills).filter((s) => !have.has(s.toLowerCase()));
  };
  if (author) {
    const m = missing(author);
    if (m.length) problems.push(`The job description is missing the template's mandatory skills: ${m.join(', ')}`);
  }
  if (needsReviewerJd(input)) {
    if (!reviewer) problems.push('The Expert review route needs a reviewer job description');
    else {
      const m = missing(reviewer);
      if (m.length) problems.push(`The reviewer job description is missing the template's mandatory skills: ${m.join(', ')}`);
      if ((reviewer.minExperienceYears ?? 0) <= (author?.minExperienceYears ?? 0)) problems.push('The reviewer job description must ask for more years of experience than the author job description');
    }
  }
  return problems;
}

/**
 * Requisition fields filled from a project JD (M10 supply): the reviewer JD for Expert and Reviewer-SME tiers, the
 * author JD otherwise. Qualifications carry the mandatory skills and the education level; notes carry the demographics.
 */
export function requisitionFromJd(jd: {
  title: string;
  responsibilities: string;
  skills: string[];
  mandatorySkills?: string[];
  minExperienceYears?: number | null;
  educationLevel?: string | null;
  demographicProfile?: JdProfileLine[];
  location?: string | null;
}) {
  const mandatory = jd.mandatorySkills?.length ? jd.mandatorySkills : jd.skills;
  return {
    title: jd.title,
    summary: jd.responsibilities.slice(0, 4000),
    minYears: jd.minExperienceYears ?? 0,
    qualifications: [
      ...mandatory.map((s) => `Skill (mandatory): ${s}`),
      ...(jd.educationLevel ? [`Education: ${educationLabel(jd.educationLevel)} or higher`] : []),
    ],
    notes: (jd.demographicProfile ?? []).map((l) => `${l.label}: ${l.text}${l.required ? ' (required)' : ' (preferred)'}`).join('\n'),
    location: jd.location ?? '',
  };
}
