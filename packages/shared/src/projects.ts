import { z } from 'zod';
import { DemographicFilterInput, filterProblems, type DemographicType } from './taxonomy';
import { CoverageDimensions, EdgeCaseCatalog, TASK_MODES, type TaskMode } from './templates';
import { JD_ROLES, JdProfileLine } from './jd-generator';

export const PROJECT_STATUSES = [
  'DRAFT',
  'READY_FOR_STAFFING',
  'STAFFING',
  'STAFFED',
  'IN_PROGRESS',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Statuses a project may be cancelled from (SPEC status table; READY_FOR_STAFFING added 26 Sep 2026). */
export const CANCELLABLE_STATUSES: ProjectStatus[] = ['DRAFT', 'READY_FOR_STAFFING', 'STAFFING', 'PAUSED'];

export const DEFAULT_MAX_TASK_COUNT = 100_000;
export const REQUIRED_WORKERS_WARNING = 500;

// ───────────────────────── Job descriptions ─────────────────────────

export const LOCATION_TYPES = ['REMOTE', 'ONSITE', 'HYBRID'] as const;

const JdFields = z.object({
  title: z.string().trim().min(1).max(200),
  responsibilities: z.string().trim().min(1).max(10_000),
  skills: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  wagePerTask: z.number().positive().max(1_000_000).multipleOf(0.01),
  wageCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO 4217 code'),
  locationType: z.enum(LOCATION_TYPES),
  location: z.string().trim().max(200).nullable().optional(),
});
const needsLocation = (jd: { locationType?: string; location?: string | null }) =>
  jd.locationType === undefined || jd.locationType === 'REMOTE' || !!jd.location?.trim();

export const CreateJobDescriptionRequest = JdFields.refine(needsLocation, {
  path: ['location'],
  message: 'Location is required for onsite and hybrid roles',
});
export type CreateJobDescriptionRequest = z.infer<typeof CreateJobDescriptionRequest>;
export const UpdateJobDescriptionRequest = JdFields.partial();

export const JobDescriptionDto = JdFields.extend({
  id: z.string().uuid(),
  location: z.string().nullable(),
  /** A generated JD starts with no pay (0) until the PM sets it; submit is blocked until then. */
  wagePerTask: z.number().min(0),
  skills: z.array(z.string()),
  updatedAt: z.string(),
  /** Generated JDs (12 Nov 2026): who it recruits, the template's mandatory skills, experience, education, demographics. */
  role: z.enum(JD_ROLES).default('AUTHOR'),
  generated: z.boolean().default(false),
  projectId: z.string().uuid().nullable().default(null),
  mandatorySkills: z.array(z.string()).default([]),
  minExperienceYears: z.number().int().nullable().default(null),
  educationLevel: z.string().nullable().default(null),
  demographicProfile: z.array(JdProfileLine).default([]),
});
export type JobDescriptionDto = z.infer<typeof JobDescriptionDto>;

// ───────────────────────── Projects ─────────────────────────

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date');

/** PM overrides of template coverage quotas (may raise, never lower below the template). */
export const CoverageQuotas = z.object({
  cells: z.array(z.object({ tags: z.record(z.string(), z.string()), quota: z.number().int().min(1) })).max(1000).default([]),
  edgeCases: z.array(z.object({ name: z.string(), quota: z.number().int().min(1) })).max(200).default([]),
});
export type CoverageQuotas = z.infer<typeof CoverageQuotas>;

export const AUTHORING_EXPERIENCES = ['CLASSIC', 'CHATBOT', 'BOTH'] as const;
export type AuthoringExperience = (typeof AUTHORING_EXPERIENCES)[number];

/** Platform review route (handover v2.1 ch. 08, 17 §2). SME_EXPERT_PM is enabled once its stage engine ships. */
export const REVIEW_ROUTES = ['SME_PM', 'SME_EXPERT_PM'] as const;
export type ReviewRoute = (typeof REVIEW_ROUTES)[number];
export const ENABLED_REVIEW_ROUTES: readonly ReviewRoute[] = ['SME_PM', 'SME_EXPERT_PM'];
export const REVIEW_ROUTE_LABELS: Record<ReviewRoute, string> = { SME_PM: 'SME → PM approval', SME_EXPERT_PM: 'SME → Expert review → PM approval' };

export const ProjectFields = z.object({
  authoringExperience: z.enum(AUTHORING_EXPERIENCES).optional(),
  reviewRoute: z.enum(REVIEW_ROUTES).optional(),
  templateId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  startDate: IsoDate.nullable().optional(),
  endDate: IsoDate.nullable().optional(),
  taskMode: z.enum(TASK_MODES).optional(),
  taskCount: z.number().int().min(1).nullable().optional(),
  distinctTarget: z.number().int().min(1).nullable().optional(),
  maxPerExpert: z.number().int().min(1).nullable().optional(),
  coverageQuotas: CoverageQuotas.nullable().optional(),
  tptMinutes: z.number().int().min(1).max(480).nullable().optional(),
  hoursPerWorkerDay: z.number().positive().max(24).optional(),
  demographicFilters: z.array(DemographicFilterInput).max(50).optional(),
  jobDescriptionId: z.string().uuid().nullable().optional(),
  /** True: Praxis generates the JDs from the template and keeps them in step with the project. False: use jobDescriptionId. */
  jdGenerated: z.boolean().optional(),
  autoLaunchCampaign: z.boolean().optional(),
});

export const CreateProjectRequest = ProjectFields;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;
export const UpdateProjectRequest = ProjectFields.partial();
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

// ───────────────────────── Computed fields (SPEC FLOW 1) ─────────────────────────

/** Monday–Friday days from start to end inclusive (no holiday calendar; decided 26 Sep 2026). */
export function workingDays(start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  const days = Math.round((e - s) / 86_400_000) + 1;
  const startDow = new Date(s).getUTCDay(); // 0 = Sunday
  const fullWeeks = Math.floor(days / 7);
  let count = fullWeeks * 5;
  for (let i = 0; i < days % 7; i++) {
    const dow = (startDow + fullWeeks * 7 + i) % 7;
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

export interface FigureInputs {
  taskMode: TaskMode;
  taskCount?: number | null;
  distinctTarget?: number | null;
  maxPerExpert?: number | null;
  tptMinutes?: number | null;
  hoursPerWorkerDay: number;
  startDate?: string | null;
  endDate?: string | null;
  wagePerTask?: number | null;
}

export interface ProjectFigures {
  /** Tasks the project produces: the distinct-task target (authoring) or the task count (annotation). */
  tasks: number | null;
  requiredAuthors: number | null;
  totalEffortHours: number | null;
  workingDays: number | null;
  requiredWorkers: number | null;
  labourBudget: number | null;
  warnings: string[];
}

/**
 * required authors = ceil(distinct-task target / max tasks per expert)
 * total effort (h) = tasks x TPT / 60
 * required workers = max(required authors, ceil(total effort / (hours per worker per day x working days)))
 * labour budget    = tasks x wage per task
 */
export function computeProjectFigures(i: FigureInputs): ProjectFigures {
  const tasks = i.taskMode === 'AUTHORING' ? (i.distinctTarget ?? null) : (i.taskCount ?? null);
  const requiredAuthors =
    i.taskMode === 'AUTHORING' && i.distinctTarget && i.maxPerExpert ? Math.ceil(i.distinctTarget / i.maxPerExpert) : null;
  const totalEffortHours = tasks && i.tptMinutes ? (tasks * i.tptMinutes) / 60 : null;
  const days = i.startDate && i.endDate ? workingDays(i.startDate, i.endDate) : null;

  let requiredWorkers: number | null = null;
  if (totalEffortHours !== null && days && i.hoursPerWorkerDay > 0) {
    const byEffort = Math.ceil(totalEffortHours / (i.hoursPerWorkerDay * days) - 1e-9);
    requiredWorkers = Math.max(requiredAuthors ?? 0, byEffort);
  }
  const labourBudget = tasks && i.wagePerTask ? Math.round(tasks * i.wagePerTask * 100) / 100 : null;

  const warnings: string[] = [];
  if (requiredWorkers !== null && requiredWorkers > REQUIRED_WORKERS_WARNING) {
    warnings.push(`This needs ${requiredWorkers} workers, more than ${REQUIRED_WORKERS_WARNING}. Consider a later end date or more hours per day.`);
  }
  if (days === 0 && i.startDate && i.endDate) warnings.push('There are no working days between the start and end dates.');
  return { tasks, requiredAuthors, totalEffortHours, workingDays: days, requiredWorkers, labourBudget, warnings };
}

/** Template quotas merged with the PM's raises: effective quota = max(template, PM). */
export function effectiveCoverage(template: { coverageDimensions?: unknown; edgeCaseCatalog?: unknown }, quotas: CoverageQuotas | null | undefined) {
  const matrix = CoverageDimensions.safeParse(template.coverageDimensions).data ?? { dimensions: [], cells: [] };
  const catalog = EdgeCaseCatalog.safeParse(template.edgeCaseCatalog).data ?? [];
  const sig = (tags: Record<string, string>) => JSON.stringify(Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)));
  const cellRaise = new Map((quotas?.cells ?? []).map((c) => [sig(c.tags), c.quota]));
  const edgeRaise = new Map((quotas?.edgeCases ?? []).map((e) => [e.name.toLowerCase(), e.quota]));
  const cells = matrix.cells.map((c) => ({ ...c, quota: Math.max(c.quota, cellRaise.get(sig(c.tags)) ?? 0) }));
  const edgeCases = catalog.map((e) => ({ ...e, quota: Math.max(e.quota, edgeRaise.get(e.name.toLowerCase()) ?? 0) }));
  const requiredSlots =
    cells.filter((c) => c.required).reduce((n, c) => n + c.quota, 0) + edgeCases.filter((e) => e.required).reduce((n, e) => n + e.quota, 0);

  const problems: string[] = [];
  for (const c of quotas?.cells ?? []) {
    const t = matrix.cells.find((x) => sig(x.tags) === sig(c.tags));
    if (!t) problems.push(`Coverage cell ${sig(c.tags)} is not in the template`);
    else if (c.quota < t.quota) problems.push(`Coverage cell quotas cannot go below the template minimum (${t.quota})`);
  }
  for (const e of quotas?.edgeCases ?? []) {
    const t = catalog.find((x) => x.name.toLowerCase() === e.name.toLowerCase());
    if (!t) problems.push(`Edge case "${e.name}" is not in the template`);
    else if (e.quota < t.quota) problems.push(`Edge case "${t.name}" quota cannot go below the template minimum (${t.quota})`);
  }
  return { cells, edgeCases, requiredSlots, problems };
}

export interface SubmitContext {
  template: {
    offerable: boolean;
    taskModes: string[];
    coverageDimensions: unknown;
    edgeCaseCatalog: unknown;
  };
  attributes: { key: string; label: string; type: DemographicType; allowedValues: unknown }[];
  jobDescription: { wagePerTask: number } | null;
  maxTaskCount: number;
  /** Problems from the generated JDs (jdProblems): mandatory skills, the reviewer JD. */
  jdProblems?: string[];
}

export interface ProjectForSubmit {
  name: string;
  taskMode: TaskMode;
  taskCount: number | null;
  distinctTarget: number | null;
  maxPerExpert: number | null;
  coverageQuotas: CoverageQuotas | null;
  tptMinutes: number | null;
  hoursPerWorkerDay: number;
  startDate: string | null;
  endDate: string | null;
  demographicFilters: z.infer<typeof DemographicFilterInput>[];
}

/** SPEC FLOW 1 validation. Problems block submit; warnings do not. */
export function submitProblems(p: ProjectForSubmit, ctx: SubmitContext): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  if (!p.name.trim()) problems.push('Project name is required');
  if (!ctx.template.offerable) problems.push('The template is no longer available for new projects; choose a current template');
  if (!ctx.template.taskModes.includes(p.taskMode)) problems.push(`This template does not allow ${p.taskMode.toLowerCase()} projects`);

  if (p.taskMode === 'AUTHORING') {
    const cov = effectiveCoverage(ctx.template, p.coverageQuotas);
    problems.push(...cov.problems);
    if (!p.distinctTarget) problems.push('Distinct-task target is required');
    else {
      if (p.distinctTarget > ctx.maxTaskCount) problems.push(`Distinct-task target can be at most ${ctx.maxTaskCount}`);
      if (p.distinctTarget < cov.requiredSlots) {
        problems.push(`Distinct-task target must be at least ${cov.requiredSlots}, the required coverage cells and edge cases`);
      }
    }
    if (!p.maxPerExpert) problems.push('Max tasks per expert is required');
    else if (p.distinctTarget && p.maxPerExpert > p.distinctTarget) problems.push('Max tasks per expert must be between 1 and the target');
  } else {
    if (!p.taskCount) problems.push('Number of tasks is required');
    else if (p.taskCount > ctx.maxTaskCount) problems.push(`Number of tasks can be at most ${ctx.maxTaskCount}`);
  }

  if (!p.tptMinutes) problems.push('TPT (minutes) is required');
  if (!p.startDate || !p.endDate) problems.push('Start date and target end date are required');
  else if (p.endDate <= p.startDate) problems.push('Target end date must be after the start date');

  if (p.demographicFilters.length === 0) problems.push('Add at least one demographic filter');
  const byKey = new Map(ctx.attributes.map((a) => [a.key, a]));
  const seen = new Set<string>();
  for (const f of p.demographicFilters) {
    const attr = byKey.get(f.attributeKey);
    if (!attr) {
      problems.push(`Unknown demographic attribute "${f.attributeKey}"`);
      continue;
    }
    if (seen.has(f.attributeKey)) problems.push(`${attr.label}: only one filter per attribute`);
    seen.add(f.attributeKey);
    problems.push(...filterProblems(attr, f));
  }

  if (!ctx.jobDescription) problems.push('Choose or create a job description');
  else if (!(ctx.jobDescription.wagePerTask > 0)) problems.push('Set the wage per task on the job description');
  problems.push(...(ctx.jdProblems ?? []));

  const figures = computeProjectFigures({ ...p, wagePerTask: ctx.jobDescription?.wagePerTask ?? null });
  return { problems, warnings: figures.warnings };
}

export const ProjectDto = z.object({
  authoringExperience: z.enum(AUTHORING_EXPERIENCES).nullable().optional(),
  reviewRoute: z.enum(REVIEW_ROUTES).optional(),
  agentMode: z.enum(['SINGLE', 'MULTI']).optional(),
  id: z.string().uuid(),
  status: z.enum(PROJECT_STATUSES),
  name: z.string(),
  description: z.string().nullable(),
  ownerId: z.string().uuid(),
  ownerName: z.string(),
  templateId: z.string().uuid(),
  templateVersion: z.number().int(),
  workflowName: z.string(),
  domainName: z.string(),
  taskMode: z.enum(TASK_MODES),
  taskCount: z.number().int().nullable(),
  distinctTarget: z.number().int().nullable(),
  maxPerExpert: z.number().int().nullable(),
  coverageQuotas: CoverageQuotas.nullable(),
  tptMinutes: z.number().int().nullable(),
  hoursPerWorkerDay: z.number(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  requiredWorkers: z.number().int().nullable(),
  demographicFilters: z.array(DemographicFilterInput),
  jobDescriptionId: z.string().uuid().nullable(),
  /** SME -> Expert -> PM projects: the generated reviewer JD (null otherwise). */
  reviewerJobDescriptionId: z.string().uuid().nullable().default(null),
  /** New projects generate their JDs from the template; false keeps a hand-picked JD. */
  jdGenerated: z.boolean().default(false),
  reviewerJdSnapshot: z.unknown().optional(),
  jdSnapshotId: z.string().uuid().nullable(),
  /** The JD as frozen at submit (null for drafts). */
  jdSnapshot: z.unknown(),
  demographicsSnapshot: z.unknown(),
  autoLaunchCampaign: z.boolean(),
  submittedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectDto = z.infer<typeof ProjectDto>;
