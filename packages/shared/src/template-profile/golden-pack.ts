import { z } from 'zod';
import { CoverageDimensions, EdgeCaseCatalog } from '../templates';
import { profileProblems, profileShapeProblems } from './helpers';
import { checkProfile, profileById } from './registry';
import { TemplateProfileSchema, type TemplateProfile } from './schema';

/**
 * Golden task pack (owner, 12 Nov 2026: "an utility to upload it later, hopefully without any code changes"). An Admin
 * uploads a JSON pack: one authoring form (a TemplateProfile v1, which is data, never code) and the worked golden cases
 * written in it. Praxis validates the pack, stores it append-only and lets a template version choose the form. A pack
 * is reference and authoring material only: execution, evaluation and reporting stay in Anvil.
 */
export const GOLDEN_PACK_SCHEMA_VERSION = 'praxis.golden_pack.v1' as const;

export const GoldenPackExample = z.object({ name: z.string().trim().min(1).max(200), output: z.record(z.string(), z.unknown()) }).strict();

export const GoldenPack = z
  .object({
    schemaVersion: z.literal(GOLDEN_PACK_SCHEMA_VERSION),
    /** Where the pack comes from (e.g. "Golden marketing reference 1.0.0"). */
    source: z.string().trim().min(1).max(500),
    profile: z.unknown(),
    /**
     * Optional: the workflow template to create when the workflow does not exist yet (new workflows are not created
     * in the console otherwise). Created as a DRAFT using this form; the Admin reviews and publishes it.
     */
    template: z
      .object({
        domainName: z.string().trim().min(1).max(100),
        primaryWork: z.string().trim().min(1).max(10_000),
        verificationCriteria: z.string().trim().min(1).max(10_000),
        humanGate: z.string().trim().min(1).max(10_000),
        skills: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
        defaultTptMinutes: z.number().int().min(1).max(480),
        taskModes: z.array(z.enum(['AUTHORING', 'ANNOTATION'])).min(1).max(2).default(['AUTHORING']),
        /** Coverage matrix and edge cases, as in the template editor; without them every task is an open slot. */
        coverageDimensions: CoverageDimensions.optional(),
        edgeCaseCatalog: EdgeCaseCatalog.optional(),
        /**
         * Reusable tasks over a case dataset (KYC five-state contract, K1/K3, 12 Nov 2026): each authored task picks one
         * value of a pick-list field (`source`, e.g. `S1.governingState`), and Anvil routes cases by `field`. One task per
         * value: the target is the number of values, and no coverage or edge-case quota may add tasks. The dataset itself
         * (id, version, hash, counts) is bound at export, never here.
         */
        caseSelector: z
          .object({
            field: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
            source: z.string().regex(/^S\d+\.[A-Za-z][A-Za-z0-9_]{0,62}$/),
            values: z.array(z.string().trim().min(1).max(50)).min(1).max(100),
          })
          .strict()
          .optional(),
        /** Distinct tasks to author per project. With a case selector it must equal the number of selector values. */
        defaultDistinctTarget: z.number().int().min(1).max(10_000).optional(),
      })
      .strict()
      .optional(),
    examples: z.array(GoldenPackExample).max(20).default([]),
  })
  .strict();
export type GoldenPack = z.infer<typeof GoldenPack>;

export interface GoldenPackCheck {
  ok: boolean;
  problems: string[];
  profile: TemplateProfile | null;
  /** One entry per example: its problems (empty = it passes every form check). */
  examples: { name: string; problems: string[] }[];
}

/** Rule citations may hold `{{RULE-KEY}}` placeholders; they are filled per project when the case is authored. */
const PLACEHOLDER = /^\{\{[A-Za-z0-9_.-]+\}\}$/;

/** Every reason a pack cannot be uploaded. `builtin` tells whether an ID belongs to a built-in form. */
export function checkGoldenPack(raw: unknown, isTaken: (profileId: string) => boolean = (id) => !!profileById(id)): GoldenPackCheck {
  const parsed = GoldenPack.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join('.') || 'pack'}: ${i.message}`), profile: null, examples: [] };
  const problems = checkProfile(parsed.data.profile).map((p) => `profile: ${p}`);
  if (problems.length) return { ok: false, problems, profile: null, examples: [] };
  const profile = TemplateProfileSchema.parse(parsed.data.profile);
  if (profile.storage !== 'sections') problems.push('profile: uploaded forms must store their values in sections (storage "sections")');
  if (profile.domainPlugin) problems.push('profile: uploaded forms cannot use a specialised editor (domainPlugin must be null)');
  if (isTaken(profile.profileId)) problems.push(`profile: the form ID "${profile.profileId}" is already in use; give a changed form a new ID (e.g. ${profile.profileId}-v2)`);
  problems.push(...caseSelectorProblems(profile, parsed.data.template));
  const names = new Set<string>();
  const examples = parsed.data.examples.map((e) => {
    const out: string[] = [];
    if (names.has(e.name)) out.push('duplicate example name');
    names.add(e.name);
    const ref = e.output.profile as { id?: unknown } | undefined;
    if (ref?.id !== profile.profileId) out.push(`output.profile.id must be "${profile.profileId}"`);
    out.push(...profileShapeProblems(profile, e.output));
    out.push(...profileProblems(profile, e.output).map((p) => `${p.path}: ${p.message}`));
    return { name: e.name, problems: out };
  });
  for (const e of examples) if (e.problems.length) problems.push(`example "${e.name}": ${e.problems.slice(0, 5).join('; ')}${e.problems.length > 5 ? ` (+${e.problems.length - 5} more)` : ''}`);
  return { ok: problems.length === 0, problems, profile, examples };
}

/** Distinct-task target a template block asks for: explicit, or one task per case-selector value. */
export function packTarget(template: GoldenPack['template']): number | null {
  if (!template) return null;
  return template.defaultDistinctTarget ?? template.caseSelector?.values.length ?? null;
}

/** A case selector must point at a pick list whose options are exactly its values, and must not multiply tasks. */
function caseSelectorProblems(profile: TemplateProfile, template: GoldenPack['template']): string[] {
  const sel = template?.caseSelector;
  if (!sel) return [];
  const out: string[] = [];
  const [sectionKey, fieldKey] = sel.source.split('.');
  const field = profile.sections.find((s) => s.key === sectionKey)?.fields.find((f) => f.key === fieldKey);
  if (!field) out.push(`template.caseSelector.source: "${sel.source}" is not a field of the form`);
  else if (field.type !== 'pick_list') out.push(`template.caseSelector.source: "${sel.source}" must be a pick_list field`);
  else {
    if (!field.required) out.push(`template.caseSelector.source: "${sel.source}" must be required, so every task names its ${sel.field}`);
    const opts = (field.options ?? []).map((o) => o.value).sort();
    const vals = [...sel.values].sort();
    if (new Set(vals).size !== vals.length) out.push('template.caseSelector.values: values must be unique');
    if (opts.join('\u0000') !== vals.join('\u0000')) out.push(`template.caseSelector.values: must equal the options of ${sel.source} exactly (${opts.join(', ')})`);
  }
  if (profile.contract?.outputsFrom !== 'template_execution') out.push('profile.contract.outputsFrom: a case-selector form must take its outputs from the template execution ("template_execution"); expected answers are private dataset material');
  if (template.defaultDistinctTarget !== undefined && template.defaultDistinctTarget !== sel.values.length)
    out.push(`template.defaultDistinctTarget: must be ${sel.values.length}, one task per ${sel.field} value`);
  if (template.coverageDimensions && (template.coverageDimensions.dimensions.length || template.coverageDimensions.cells.length))
    out.push('template.coverageDimensions: a case-selector template has no coverage quotas; cases are dataset inputs, not authored tasks');
  if (template.edgeCaseCatalog?.length) out.push('template.edgeCaseCatalog: a case-selector template has no edge-case quotas; cases are dataset inputs, not authored tasks');
  return out;
}

/** True for a policy citation value that is a placeholder to fill per project. */
export const isRulePlaceholder = (v: unknown) => typeof v === 'string' && PLACEHOLDER.test(v);
