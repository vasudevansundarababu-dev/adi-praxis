import { stepToolWarnings, type TemplateProfileField } from '@praxis/shared';
import { z } from 'zod';
import { vertexCompleter, type Completer } from '../../policy/rule-assistant';
import { suggestionsModel } from '../suggestions/assistant';

/**
 * D-027 (owner, 23 Nov 2026): help the SME write each field.
 * - "Show an example": a ready-to-adapt example in a compliance analyst's voice for this field of the live template, plus
 *   one or two "don't write this" examples where the field's own rules say so. Filled into the field only on the SME's click.
 * - "Check this": the SME's own text reviewed against the field's rules and the section's purpose: missing content, too
 *   specific for a reusable workflow (case IDs, names, dates), contradictions with other sections, vague wording, private
 *   content in agent-visible text, and (S5) step text vs. tool. Plain suggestions and an optional rewrite the SME accepts
 *   or ignores. Rule-based checks always run; the model adds a review when configured. Nothing is stored or decided.
 */
export interface CoachField {
  section: { key: string; title: string };
  field: Pick<TemplateProfileField, 'key' | 'label' | 'help' | 'type'> & { example?: string; visibility?: string };
}
export interface Finding {
  kind: 'too_specific' | 'vague' | 'private_content' | 'missing_content' | 'contradiction' | 'step_tool' | 'other';
  message: string;
}
export interface CheckResult {
  findings: Finding[];
  rewrite: string | null;
  reviewedBy: 'rules' | 'rules_and_model';
  modelNote?: string;
}
export interface ExampleResult {
  example: string;
  avoid: { text: string; why: string }[];
  source: 'template' | 'model' | 'rules';
}

export interface FieldCoachModel {
  readonly modelVersion: string;
  example(f: CoachField, ctx: { workflow: string; otherSections: string }): Promise<{ example: string; avoid: { text: string; why: string }[] }>;
  review(f: CoachField, text: string, ctx: { workflow: string; otherSections: string }): Promise<{ findings: { issue: string; suggestion: string }[]; rewrite: string | null }>;
}
export class CoachUnavailableError extends Error {}

const PRIVATE = new Set(['private', 'private_rubric', 'grader_only', 'reference']);
const reusable = (f: CoachField) => f.section.key === 'S1' || f.section.key === 'S5' || /reusable|not one|not an individual|across (all|assigned)|each assigned/i.test(f.field.help ?? '');

const ID = /\b[A-Z]{2,}-\d{2,}\b|\b(?:APP|CASE|CUS|ACC|ACCT)[-_ ]?\d{3,}\b/g;
const DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const QUOTED_NAME = /["“]([A-Z][a-z]+ [A-Z][a-z]+)["”]|\b(?:Mr|Mrs|Ms|Dr)\.? [A-Z][a-z]+/g;
const VAGUE = /\b(etc\.?|and so on|as needed|as appropriate|appropriately|various|something|stuff|TBD|to be decided|n\/a)\b/i;
const LEAK = /\b(expected (outcome|answer|result)|correct answer|the answer is|reference answer|should be (approved|declined|rejected)|grader|rubric|scoring)\b/i;

/** The rule-based review (always available; also the fallback when the model is not). */
export function ruleCheck(f: CoachField, text: string, steps?: unknown, tools?: string[] | null): { findings: Finding[]; rewrite: string | null } {
  const t = text.trim();
  const findings: Finding[] = [];
  let rewrite: string | null = null;
  if (!t) return { findings: [{ kind: 'missing_content', message: `${f.field.label} is empty. ${f.field.help ?? ''}`.trim() }], rewrite: null };
  if (reusable(f)) {
    const ids = [...new Set(t.match(ID) ?? [])];
    const dates = [...new Set(t.match(DATE) ?? [])];
    const emails = [...new Set(t.match(EMAIL) ?? [])];
    const names = [...new Set([...t.matchAll(QUOTED_NAME)].map((m) => m[0]))];
    const bits = [ids.length && `case or application IDs (${ids.join(', ')})`, dates.length && `specific dates (${dates.join(', ')})`, emails.length && 'email addresses', names.length && `personal names (${names.join(', ')})`].filter(Boolean);
    if (bits.length) {
      findings.push({ kind: 'too_specific', message: `This field describes a reusable workflow, so it should fit every assigned application, not one case. It mentions ${bits.join(', ')}. Describe the kind of event or applicant instead.` });
      rewrite = t
        .replace(new RegExp(`\\b(?:application|case|customer|account|file)\\s+(?:${ID.source})`, 'gi'), 'an application')
        .replace(ID, 'an application')
        .replace(DATE, 'the application date')
        .replace(EMAIL, 'the applicant’s email')
        .replace(QUOTED_NAME, 'the applicant')
        .replace(/^./, (c) => c.toUpperCase());
    }
  }
  const words = t.split(/\s+/).length;
  if (f.field.type === 'long_text' && words < 8) findings.push({ kind: 'vague', message: `This is very short for ${f.field.label}. ${f.field.help ? `The field asks for: ${f.field.help}` : 'Add the who, what and when.'}` });
  const vague = VAGUE.exec(t);
  if (vague) findings.push({ kind: 'vague', message: `“${vague[0]}” is vague. Say exactly what is meant, so a reviewer and the agent read it the same way.` });
  if (!PRIVATE.has(f.field.visibility ?? '') && LEAK.test(t)) findings.push({ kind: 'private_content', message: 'This text is shown to the agent, but it talks about the expected answer or how the task is graded. Keep expected outcomes and grading in the private fields.' });
  if (steps !== undefined) for (const w of stepToolWarnings(steps, tools ?? null)) findings.push({ kind: 'step_tool', message: w.message });
  return { findings, rewrite };
}

/** "Don't write this" examples derived from the field's own rules (used with or without the model). */
export function avoidFromRules(f: CoachField, workflow: string): { text: string; why: string }[] {
  const out: { text: string; why: string }[] = [];
  const help = f.field.help ?? '';
  if (/not one|identifier|not an individual|reusable/i.test(help) || f.section.key === 'S1')
    out.push({ text: `Application APP-1042 for Elena Vance is submitted on 2026-03-14.`, why: 'Names one application, person and date. The workflow must fit every application of this kind.' });
  if (f.field.type === 'long_text') out.push({ text: 'Do the usual checks as needed, etc.', why: 'Too vague: it does not say which checks, when, or what the result should be.' });
  return out.slice(0, 2).map((a) => ({ ...a, text: a.text.replace('workflow', workflow) }));
}

const ExOut = z.object({ example: z.string().min(5).max(2000), avoid: z.array(z.object({ text: z.string().max(500), why: z.string().max(500) })).max(3).default([]) });
const RevOut = z.object({ findings: z.array(z.object({ issue: z.string().max(500), suggestion: z.string().max(800) })).max(8).default([]), rewrite: z.string().max(4000).nullable().default(null) });

const SYSTEM_EXAMPLE = `You help a compliance subject-matter expert write one field of a reusable task template for training AI agents.
Write a short, ready-to-adapt example for the field in a senior compliance analyst's voice. It must be generic and reusable (no case IDs, personal names or specific dates), fully synthetic, and follow the field's help. Use plain words, never internal codes (no words joined by underscores). Also give one or two short "don't write this" examples with the reason, where the field's rules forbid something.
Return JSON only: {"example":"...","avoid":[{"text":"...","why":"..."}]}`;
const SYSTEM_REVIEW = `You review one field a compliance subject-matter expert wrote in a reusable task template for training AI agents.
Check: required content for the field (per its help) is present; it is not too specific (case IDs, names, dates) where a reusable workflow is needed; it does not contradict the other sections; it is not vague; agent-visible text does not reveal expected answers or grading. Give at most 5 findings in plain English, each with a concrete suggestion, and a proposed rewrite of the whole text (or null if it is fine). Never use internal codes. Never write case facts or expected answers.
Return JSON only: {"findings":[{"issue":"...","suggestion":"..."}],"rewrite":"..." or null}`;
const fieldBlock = (f: CoachField, workflow: string) => `<workflow>${workflow}</workflow>\n<section>${f.section.key} ${f.section.title}</section>\n<field label="${f.field.label}">${f.field.help ?? ''}${f.field.example ? `\nTemplate example: ${f.field.example}` : ''}</field>`;
const parse = (t: string) => JSON.parse(t.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));

export class ModelFieldCoach implements FieldCoachModel {
  constructor(readonly modelVersion: string, private readonly llm: Completer) {}
  async example(f: CoachField, ctx: { workflow: string; otherSections: string }) {
    try {
      const r = ExOut.parse(parse(await this.llm.complete(SYSTEM_EXAMPLE, `${fieldBlock(f, ctx.workflow)}\n<other_sections>${ctx.otherSections}</other_sections>`, 2000, { quick: true, timeoutMs: 22_000 })));
      return r;
    } catch (err) {
      throw new CoachUnavailableError(err instanceof Error ? err.message : 'Model call failed', { cause: err });
    }
  }
  async review(f: CoachField, text: string, ctx: { workflow: string; otherSections: string }) {
    try {
      return RevOut.parse(parse(await this.llm.complete(SYSTEM_REVIEW, `${fieldBlock(f, ctx.workflow)}\n<other_sections>${ctx.otherSections}</other_sections>\n<author_text>${text.replace(/<\/?author_text>/g, '')}</author_text>`, 3000, { quick: true, timeoutMs: 22_000 })));
    } catch (err) {
      throw new CoachUnavailableError(err instanceof Error ? err.message : 'Model call failed', { cause: err });
    }
  }
}

export function defaultFieldCoach(config: { assistantMode: string; VERTEX_PROJECT_ID: string; VERTEX_LOCATION: string; FIELD_SUGGESTIONS_MODEL: string; PROFILE_MODEL: string; AUTHORING_MODEL: string }): FieldCoachModel | null {
  if (config.assistantMode !== 'vertex') return null;
  const c = vertexCompleter(suggestionsModel(config), { projectId: config.VERTEX_PROJECT_ID, location: config.VERTEX_LOCATION });
  return new ModelFieldCoach(c.model, c);
}
