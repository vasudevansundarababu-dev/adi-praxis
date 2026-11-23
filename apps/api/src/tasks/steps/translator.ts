import { cleanStep, stepToolWarnings, TOOL_CHAINS, TOOL_PURPOSE, toolOptionLabel, translateProcedure, type ProcedureStep, type StepToolWarning } from '@praxis/shared';
import { z } from 'zod';
import { vertexCompleter, type Completer } from '../../policy/rule-assistant';
import { suggestionsModel } from '../suggestions/assistant';

/**
 * D-016 (owner, 23 Nov 2026): the SME writes the procedure in business language ("Screen both joint applicants. If
 * either has an unresolved match, record the finding and refer the case according to policy. Submit the final
 * recommendation with the evidence.") and Authoring turns it into S5 steps: one routine tool per step, conditional
 * follow-ups for referral and findings, and the final recommendation. It proposes only; the SME reviews, edits and
 * applies the steps, and nothing is saved until they do. The model never decides anything about the task.
 */
export interface StepTranslator {
  readonly modelVersion: string;
  translate(text: string, offered: string[]): Promise<ProcedureStep[]>;
}
export class StepTranslatorUnavailableError extends Error {}

export const TRANSLATE_MAX_TEXT = 4000;

/** The deterministic translation (tests, local dev, and whenever no model is configured). */
export class MockStepTranslator implements StepTranslator {
  readonly modelVersion = 'mock-step-translator-1';
  async translate(text: string, offered: string[]) {
    return translateProcedure(text, offered);
  }
}

const SYSTEM = `You turn a KYC subject-matter expert's description of an investigation procedure into structured steps for an AI agent.
Rules:
- Each step has one main tool, chosen ONLY from the tool guide below by its purpose. Never invent a tool.
- finding.write and specialist.refer happen only when a check finds a problem: put them in that check's "followUps" with the condition in "if", never as a step's main tool.
- A follow-up without a condition is allowed only to continue a chain the guide shows with an arrow (documents.list → document.read).
- Keep the expert's wording for each action; do not add facts, names, case findings or expected answers.
- End with the final recommendation step (tool "recommend") when the guide offers it.
Return JSON only: {"steps":[{"action":"...","tool":"<tool id or empty>","followUps":[{"if":"<condition>","tools":["<tool id>"]}]}]}`;

export function translateUser(text: string, offered: string[]): string {
  const guide = offered.map((t) => `- ${toolOptionLabel(t)}${TOOL_PURPOSE[t] ? '' : ' (no stated purpose)'}`).join('\n');
  const chains = Object.entries(TOOL_CHAINS).filter(([t]) => offered.includes(t)).map(([t, c]) => `${t} → ${c.join(' → ')}`).join('; ') || 'none';
  return `Tool guide (purpose — tool):\n${guide}\nChains: ${chains}\n\n<procedure>\n${text.replace(/<\/?procedure>/gi, '')}\n</procedure>`;
}

const Out = z.object({ steps: z.array(z.object({ action: z.string().min(1).max(2000), tool: z.string().max(100).optional().default(''), followUps: z.array(z.object({ if: z.string().max(500).optional(), tools: z.array(z.string().max(100)).max(5) })).max(5).optional() })).min(1).max(30) });

export class ModelStepTranslator implements StepTranslator {
  constructor(readonly modelVersion: string, private readonly llm: Completer) {}
  async translate(text: string, offered: string[]) {
    let out: string;
    try {
      out = await this.llm.complete(SYSTEM, translateUser(text, offered), 4000, { quick: true, timeoutMs: 22_000 });
    } catch (err) {
      throw new StepTranslatorUnavailableError(err instanceof Error ? err.message : 'Model call failed');
    }
    let json: unknown;
    try {
      json = JSON.parse(out.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new StepTranslatorUnavailableError('The model did not return JSON.');
    }
    const r = Out.safeParse(json);
    if (!r.success) throw new StepTranslatorUnavailableError('The model output failed validation.');
    // Tools the template does not offer are blanked; the guide's checks then show what to look at.
    return r.data.steps.map((s) => cleanStep(s, offered));
  }
}

export function defaultStepTranslator(config: { assistantMode: string; VERTEX_PROJECT_ID: string; VERTEX_LOCATION: string; FIELD_SUGGESTIONS_MODEL: string; PROFILE_MODEL: string; AUTHORING_MODEL: string }): StepTranslator {
  if (config.assistantMode !== 'vertex') return new MockStepTranslator();
  const c = vertexCompleter(suggestionsModel(config), { projectId: config.VERTEX_PROJECT_ID, location: config.VERTEX_LOCATION });
  return new ModelStepTranslator(c.model, c);
}

export interface Translation {
  steps: ProcedureStep[];
  warnings: StepToolWarning[];
  model: string;
}
export async function translateSteps(t: StepTranslator, text: string, offered: string[]): Promise<Translation> {
  const steps = await t.translate(text, offered);
  return { steps, warnings: stepToolWarnings(steps, offered), model: t.modelVersion };
}
