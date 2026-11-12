import { z } from 'zod';
import { canonicalJson } from '../workflow-graph/projection';
import { checkGoldenPack, type GoldenPackCheck } from './golden-pack';

/**
 * Template proposal from Anvil (Praxis-Anvil contract, approved 12 Nov 2026, docs/anvil/PRAXIS-ANVIL-CONTRACT-FINAL.md).
 * Anvil starts every new template or template change. A proposal is a golden pack (Praxis's authoring part: form,
 * optional template and examples) plus the parts Anvil owns: the execution part and the skills for authoring and
 * reviewing. Praxis checks authorability only; it stores the execution part unchanged and never edits it.
 * The joint format is open question 1 with Anvil; until it is answered this is `praxis.template_spec.v1-proposed`.
 */
export const TEMPLATE_SPEC_SCHEMA = 'praxis.template_spec.v1-proposed' as const;

const Skills = z
  .object({
    mandatory: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    preferred: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    specialties: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    jurisdictions: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
    languages: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
    certifications: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  })
  .strict();

export const TemplateSpec = z
  .object({
    schemaVersion: z.literal(TEMPLATE_SPEC_SCHEMA),
    /** Anvil's reference to the customer or segment requirement and sales channel. No customer-confidential data. */
    requirement: z.object({ id: z.string().trim().min(1).max(200), channel: z.string().trim().max(100).optional(), summary: z.string().trim().max(2000).optional() }).strict(),
    /** Praxis's authoring part, as a golden task pack (form, optional template for a new workflow, examples). */
    pack: z.unknown(),
    /** Anvil-owned: the execution part. Stored unchanged; Praxis only references it. */
    execution: z
      .object({
        capabilityCatalogVersion: z.string().trim().min(1).max(100),
        environment: z.record(z.string(), z.unknown()),
        tools: z.array(z.object({ name: z.string().trim().min(1).max(100), inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()) }).passthrough()).max(200),
        /** Evaluator kinds this template allows, from Anvil's catalogue. Each authored criterion picks one. */
        evaluatorKinds: z.array(z.string().trim().min(1).max(100)).max(50),
        outputSchema: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
    /** Anvil-owned: skills for authoring and for reviewing. Praxis decides roles and the review route per project. */
    skills: z.object({ authoring: Skills, reviewing: Skills }).strict(),
  })
  .strict();
export type TemplateSpec = z.infer<typeof TemplateSpec>;

export interface SpecIssue {
  code: string;
  owner: 'anvil';
  file: string;
  pointer: string;
  message: string;
  fix: string;
}

export interface TemplateSpecCheck {
  valid: boolean;
  errors: SpecIssue[];
  /** Praxis-side work (not Anvil errors), e.g. staffing advice. Filled by the server. */
  praxisRequirements: { code: string; message: string }[];
  pack: GoldenPackCheck | null;
}

const issue = (code: string, pointer: string, message: string, fix: string): SpecIssue => ({ code, owner: 'anvil', file: 'template-spec.json', pointer, message, fix });

/** Authorability check of a template proposal (read-only). `isTaken`: whether a form ID is already in use. */
export function checkTemplateSpec(raw: unknown, isTaken: (profileId: string) => boolean): TemplateSpecCheck {
  const parsed = TemplateSpec.safeParse(raw);
  if (!parsed.success) {
    return { valid: false, praxisRequirements: [], pack: null, errors: parsed.error.issues.map((i) => issue(i.path[0] === 'schemaVersion' ? 'TP_SCHEMA_VERSION' : 'TP_SPEC_SHAPE', `/${i.path.join('/')}`, i.message, 'Send the template spec in the published shape (GET /contracts).')) };
  }
  const spec = parsed.data;
  const errors: SpecIssue[] = [];
  const pack = checkGoldenPack(spec.pack, isTaken);
  for (const p of pack.problems) {
    const code = /unsupported field type/.test(p) ? 'TP_FIELD_TYPE_UNSUPPORTED' : /^example/.test(p) ? 'TP_EXAMPLE_INVALID' : /weight/i.test(p) ? 'TP_CRITERIA_WEIGHTS' : /already in use/.test(p) ? 'TP_FORM_ID_TAKEN' : 'TP_FORM_INVALID';
    errors.push(issue(code, '/pack', p, code === 'TP_FORM_ID_TAKEN' ? 'Give a changed form a new ID; IDs are never reused.' : 'Repair the authoring part as described.'));
  }
  if (!spec.skills.authoring.mandatory.length) errors.push(issue('TP_SKILLS_MISSING', '/skills/authoring/mandatory', 'No mandatory authoring skills: Praxis cannot generate the author job description.', 'List at least one mandatory authoring skill.'));
  if (!spec.skills.reviewing.mandatory.length) errors.push(issue('TP_SKILLS_MISSING', '/skills/reviewing/mandatory', 'No mandatory reviewing skills: Praxis cannot generate the reviewer job description.', 'List at least one mandatory reviewing skill.'));
  if (pack.profile) {
    // Criteria are authored per task; each picks one of the template's evaluator kinds, so at least one is needed.
    if (!spec.execution.evaluatorKinds.length) errors.push(issue('TP_EVALUATOR_KIND_UNKNOWN', '/execution/evaluatorKinds', 'No evaluator kinds: authored rubric criteria could not be graded.', 'List the evaluator kinds from the capability catalogue that this template allows.'));
    // Every tool the form offers needs a schema in the execution part.
    const s3 = pack.profile.sections.find((s) => s.key === 'S3');
    const offered = (s3?.fields.find((f) => f.key === 'tools')?.options ?? []).map((o) => o.value);
    const described = new Set(spec.execution.tools.map((t) => t.name));
    for (const t of offered) if (!described.has(t)) errors.push(issue('TP_TOOL_SCHEMA_MISSING', '/execution/tools', `Tool "${t}" is offered by the form but has no input/output schema.`, 'Add the tool with its inputSchema and outputSchema from the capability catalogue.'));
    if (!Object.keys(spec.execution.outputSchema).length) errors.push(issue('TP_OUTPUT_SCHEMA', '/execution/outputSchema', 'The final-answer schema is empty.', 'Provide the output schema of the final answer.'));
  }
  return { valid: errors.length === 0, errors, praxisRequirements: [], pack };
}

/** Hash both sides accept for one template version (RFC 8785 canonical JSON, proposed in open question 2). */
export function templateVersionContent(t: { workflowName: string; version: number; profile: unknown; execution: unknown; skills: unknown }) {
  return canonicalJson({ workflowName: t.workflowName, version: t.version, profile: t.profile ?? null, execution: t.execution ?? null, skills: t.skills ?? null });
}
