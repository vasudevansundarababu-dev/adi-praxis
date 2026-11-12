import { z } from 'zod';

export const TEMPLATE_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TASK_MODES = ['AUTHORING', 'ANNOTATION'] as const;
export type TaskMode = (typeof TASK_MODES)[number];

const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lower_snake_case (letters, digits, underscores)')
  .max(60);

/**
 * Coverage matrix (SPEC: Task diversity and coverage). Dimensions list their allowed values; cells are the
 * combinations a project must cover, each with a quota and a required flag. A cell may name a subset of the
 * dimensions (e.g. just customer_type = corporate).
 */
export const CoverageDimensions = z
  .object({
    dimensions: z
      .array(
        z.object({
          key,
          label: z.string().trim().min(1).max(100),
          values: z.array(z.string().trim().min(1).max(100)).max(200),
        }),
      )
      .max(20)
      .default([]),
    cells: z
      .array(
        z.object({
          tags: z.record(key, z.string().trim().min(1)),
          quota: z.number().int().min(1).default(1),
          required: z.boolean().default(true),
        }),
      )
      .max(1000)
      .default([]),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.dimensions.forEach((d, i) => {
      if (seen.has(d.key)) ctx.addIssue({ code: 'custom', path: ['dimensions', i, 'key'], message: `Duplicate dimension "${d.key}"` });
      seen.add(d.key);
      if (new Set(d.values).size !== d.values.length) {
        ctx.addIssue({ code: 'custom', path: ['dimensions', i, 'values'], message: `Duplicate values in "${d.key}"` });
      }
    });
    const byKey = new Map(m.dimensions.map((d) => [d.key, new Set(d.values)]));
    const cellKeys = new Set<string>();
    m.cells.forEach((c, i) => {
      const entries = Object.entries(c.tags);
      if (entries.length === 0) ctx.addIssue({ code: 'custom', path: ['cells', i, 'tags'], message: 'A cell needs at least one tag' });
      for (const [k, v] of entries) {
        const allowed = byKey.get(k);
        if (!allowed) ctx.addIssue({ code: 'custom', path: ['cells', i, 'tags', k], message: `Unknown dimension "${k}"` });
        else if (!allowed.has(v)) ctx.addIssue({ code: 'custom', path: ['cells', i, 'tags', k], message: `"${v}" is not an allowed value of "${k}"` });
      }
      const sig = JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
      if (cellKeys.has(sig)) ctx.addIssue({ code: 'custom', path: ['cells', i], message: 'Duplicate cell' });
      cellKeys.add(sig);
    });
  });
export type CoverageDimensions = z.infer<typeof CoverageDimensions>;

export const EdgeCaseCatalog = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(2000).default(''),
      quota: z.number().int().min(1).default(1),
      required: z.boolean().default(true),
    }),
  )
  .max(200)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((e, i) => {
      const n = e.name.toLowerCase();
      if (seen.has(n)) ctx.addIssue({ code: 'custom', path: [i, 'name'], message: `Duplicate edge case "${e.name}"` });
      seen.add(n);
    });
  });
export type EdgeCaseCatalog = z.infer<typeof EdgeCaseCatalog>;

/** Opaque in v1 (separate task-definition spec), but must be a JSON object. */
const JsonObject = z.record(z.string(), z.unknown());

/** Editable template fields. All optional so drafts can be saved incomplete; publish enforces the core set. */
export const TemplateFields = z.object({
  workflowName: z.string().trim().min(1).max(200),
  primaryWork: z.string().trim().max(10_000).nullable().optional(),
  verificationCriteria: z.string().trim().max(10_000).nullable().optional(),
  humanGate: z.string().trim().max(10_000).nullable().optional(),
  taskDefinitionSchema: JsonObject.optional(),
  collectionSchema: JsonObject.optional(),
  defaultTptMinutes: z.number().int().min(1).max(480).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  taskModes: z.array(z.enum(TASK_MODES)).max(2).optional(),
  coverageDimensions: CoverageDimensions.optional(),
  edgeCaseCatalog: EdgeCaseCatalog.optional(),
  defaultDistinctTarget: z.number().int().min(1).max(100_000).optional(),
  defaultMaxPerExpert: z.number().int().min(1).max(1000).optional(),
  openSlotShare: z.number().min(0).max(1).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  /** The authoring form of this version (a registered profile of the same workflow); null = the workflow's default. */
  profileId: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).nullable().optional(),
});

export const CreateTemplateRequest = TemplateFields.extend({ domainId: z.string().uuid() });
export type CreateTemplateRequest = z.infer<typeof CreateTemplateRequest>;

export const UpdateTemplateRequest = TemplateFields.partial();
export type UpdateTemplateRequest = z.infer<typeof UpdateTemplateRequest>;

export const DomainDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'RETIRED']),
});
export type DomainDto = z.infer<typeof DomainDto>;

export const CreateDomainRequest = z.object({ name: z.string().trim().min(1).max(100) });

export const TemplateDto = z.object({
  id: z.string().uuid(),
  lineageId: z.string().uuid(),
  version: z.number().int(),
  status: z.enum(TEMPLATE_STATUSES),
  domainId: z.string().uuid(),
  domainName: z.string(),
  workflowName: z.string(),
  primaryWork: z.string().nullable(),
  verificationCriteria: z.string().nullable(),
  humanGate: z.string().nullable(),
  taskDefinitionSchema: z.record(z.string(), z.unknown()),
  collectionSchema: z.record(z.string(), z.unknown()),
  defaultTptMinutes: z.number().int().nullable(),
  skills: z.array(z.string()),
  taskModes: z.array(z.enum(TASK_MODES)),
  coverageDimensions: z.unknown(),
  edgeCaseCatalog: z.unknown(),
  defaultDistinctTarget: z.number().int(),
  defaultMaxPerExpert: z.number().int(),
  openSlotShare: z.number(),
  similarityThreshold: z.number(),
  profileId: z.string().nullable(),
  publishedAt: z.string().nullable(),
  retiredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TemplateDto = z.infer<typeof TemplateDto>;

/** Fields that must be filled before a template can be published (decided 26 Sep 2026). */
export function publishProblems(t: {
  workflowName: string;
  primaryWork: string | null;
  verificationCriteria: string | null;
  humanGate: string | null;
  defaultTptMinutes: number | null;
  skills: string[];
  taskModes: string[];
}): string[] {
  const problems: string[] = [];
  if (!t.workflowName.trim()) problems.push('Workflow name is required');
  if (!t.primaryWork?.trim()) problems.push('Primary work is required');
  if (!t.verificationCriteria?.trim()) problems.push('Verification criteria are required');
  if (!t.humanGate?.trim()) problems.push('Human gate is required');
  if (!t.defaultTptMinutes) problems.push('Default TPT (minutes) is required');
  if (t.skills.length === 0) problems.push('At least one skill is required');
  if (t.taskModes.length === 0) problems.push('At least one task mode is required');
  return problems;
}
