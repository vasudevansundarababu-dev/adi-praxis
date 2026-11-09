import { CustomField, type HarborBlueprint } from '@praxis/shared';
import { z } from 'zod';
import { fieldProblems } from './blueprint';
import { DATA_RULES, dataJson, dataText, DrafterError, extractJson, type DraftPrompt } from './drafter';

export const PROMPT_VERSION = 'meta-compiler/1';

/** The blueprint as the model sees it: structure only, no authored oracle or verifier code. */
function promptView(bp: HarborBlueprint) {
  const { authored_content: _a, ...rest } = bp;
  return { ...rest, step_5_default_rubric: { milestones: bp.step_5_default_rubric.milestones.map(({ verifier_body: _v, ...m }) => m) } };
}

// ───────────────────────────── D7: propose one custom field ─────────────────────────────

export function fieldProposalPrompt(bp: HarborBlueprint, stage: string, request: string): DraftPrompt {
  return {
    purpose: 'propose_field',
    maxOutputTokens: 1024,
    system: `You help an Admin design a Harbor task template by proposing ONE custom field for ${stage}.
Return {"field_id","label","input_type","options","default_value","min","max","inject_into","verifier_assertion"}.
input_type is one of number_input, currency_slider, single_select, multi_select, boolean_toggle, text_input.
inject_into lists one or more of instruction.md, task.json, mcp_mock.py, eval/test_verifiers.py.
${DATA_RULES}`,
    user: `<blueprint>\n${dataJson(promptView(bp))}\n</blueprint>\n<request>\n${dataText(request)}\n</request>`,
  };
}

/** Parses and validates a proposal exactly like a field added by hand (S2-08). Never saved here. */
export function parseFieldProposal(text: string, existingIds: string[], stage: 'stage_1' | 'stage_2' | 'stage_3' | 'stage_4' | 'stage_5'): { proposal: CustomField | null; problems: string[] } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (err) {
    return { proposal: null, problems: [(err as Error).message] };
  }
  const parsed = CustomField.safeParse(raw);
  if (!parsed.success) return { proposal: null, problems: parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`) };
  const problems = fieldProblems(parsed.data, stage);
  if (existingIds.includes(parsed.data.field_id)) problems.push(`Custom field "${parsed.data.field_id}" is used more than once in this template`);
  return { proposal: parsed.data, problems };
}

// ───────────────────────────── Step 1: draft the content the blueprint is missing ─────────────────────────────

export interface MissingContent {
  instruction_md: boolean;
  solve_sh: boolean;
  verifier_bodies: string[];
}

export function missingContent(bp: HarborBlueprint): MissingContent {
  return {
    instruction_md: !bp.authored_content.instruction_md.trim(),
    solve_sh: !bp.authored_content.solve_sh.trim(),
    verifier_bodies: bp.step_5_default_rubric.milestones.filter((m) => !m.verifier_body.trim()).map((m) => m.id),
  };
}

export const nothingMissing = (m: MissingContent) => !m.instruction_md && !m.solve_sh && m.verifier_bodies.length === 0;

export function blueprintContentPrompt(bp: HarborBlueprint, missing: MissingContent): DraftPrompt {
  return {
    purpose: 'blueprint_content',
    maxOutputTokens: 8192,
    system: `You draft missing content for a Harbor task template: the agent instruction (markdown), the oracle script solution/solve.sh (POSIX sh) and Python verifier bodies (assertions over env_state) for the listed rubric milestones.
Return {"instruction_md"?: string, "solve_sh"?: string, "verifier_bodies": {"<milestone id>": string}} with only the parts listed in <missing>.
${DATA_RULES}`,
    user: `<blueprint>\n${dataJson(promptView(bp))}\n</blueprint>\n<missing>\n${dataJson(missing)}\n</missing>`,
  };
}

const DraftedContent = z.object({
  instruction_md: z.string().min(1).max(20_000).optional(),
  solve_sh: z.string().min(1).max(20_000).optional(),
  verifier_bodies: z.record(z.string(), z.string().min(1).max(20_000)).default({}),
});
export type DraftedContent = z.infer<typeof DraftedContent>;

/** Schema-validates drafted content; anything invalid or outside what was asked fails the whole run (nothing partly applied). */
export function parseDraftedContent(text: string, missing: MissingContent): DraftedContent {
  const parsed = DraftedContent.safeParse(extractJson(text));
  if (!parsed.success) throw new DrafterError(`Drafted content failed validation: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  const d = parsed.data;
  if ((d.instruction_md && !missing.instruction_md) || (d.solve_sh && !missing.solve_sh)) throw new DrafterError('Drafted content changed parts that were not missing');
  const extra = Object.keys(d.verifier_bodies).filter((id) => !missing.verifier_bodies.includes(id));
  if (extra.length) throw new DrafterError(`Drafted verifier bodies for unknown milestones: ${extra.join(', ')}`);
  if ((missing.instruction_md && !d.instruction_md) || (missing.solve_sh && !d.solve_sh) || missing.verifier_bodies.some((id) => !d.verifier_bodies[id])) {
    throw new DrafterError('Drafted content is incomplete');
  }
  return d;
}

/** The blueprint with drafted content filled into the blanks only. Admin-accepted content is never replaced. */
export function withDraftedContent(bp: HarborBlueprint, d: DraftedContent): HarborBlueprint {
  const out = structuredClone(bp);
  if (d.instruction_md && !out.authored_content.instruction_md.trim()) out.authored_content.instruction_md = d.instruction_md;
  if (d.solve_sh && !out.authored_content.solve_sh.trim()) out.authored_content.solve_sh = d.solve_sh;
  out.step_5_default_rubric.milestones = out.step_5_default_rubric.milestones.map((m) => (m.verifier_body.trim() || !d.verifier_bodies[m.id] ? m : { ...m, verifier_body: d.verifier_bodies[m.id]! }));
  return out;
}

// ───────────────────────────── FULL_CODE (D5 option A, off by default) ─────────────────────────────

export function fullCodePrompt(bp: HarborBlueprint): DraftPrompt {
  return {
    purpose: 'full_code',
    maxOutputTokens: 32_000,
    system: `You generate the source of a stand-alone SME authoring studio for the Harbor template described in <blueprint>.
Return {"files": {"<relative path>": "<file content>"}}. Paths are relative, without "..".
${DATA_RULES}`,
    user: `<blueprint>\n${dataJson(promptView(bp))}\n</blueprint>`,
  };
}

const CodeFiles = z.object({ files: z.record(z.string().regex(/^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]{1,200}$/), z.string().max(200_000)) });

export function parseFullCode(text: string): Record<string, string> {
  const parsed = CodeFiles.safeParse(extractJson(text));
  if (!parsed.success || Object.keys(parsed.data.files).length === 0) throw new DrafterError('Generated code failed validation');
  return parsed.data.files;
}
