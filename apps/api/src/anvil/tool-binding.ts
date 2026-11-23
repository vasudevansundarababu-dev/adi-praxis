import { stepToolWarnings, type TaskCheck } from '@praxis/shared';
/**
 * APR-13d (owner, 20 Nov 2026): tool bindings must come from the template's runtime catalogue. A procedure step's
 * `tool` (`S5.steps[].tool`) is free text on the form, so nothing stopped an author naming a tool the template does
 * not declare; RL Gym's importer then refused the task (`PX_TOOL_CALL_MISSING`). This check is generic: for any
 * template version whose execution part declares `tools`, every non-empty step tool must be exactly one of those
 * tools' IDs. A blank tool (the field is optional) is allowed. Templates without `execution.tools` are not checked.
 *
 * Used by the per-task export package checks, so it runs at every approval (D18 re-validation), in the live RL Gym
 * export and in the offline authored export.
 */
export const TOOL_UNDECLARED = 'GENERIC_TOOL_UNDECLARED' as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Where step tools live in an authored record (relative to its `authored` object). */
export const STEP_TOOL_SECTION = 'S5';
export const STEP_TOOL_LIST = 'steps';
export const stepToolPointer = (i: number) => `/sections/${STEP_TOOL_SECTION}/${STEP_TOOL_LIST}/${i}/tool`;

/** The tool IDs a template version's execution part declares, or null when it declares no `tools` list. */
export function declaredToolIds(execution: unknown): string[] | null {
  if (!isObj(execution) || !Array.isArray(execution.tools)) return null;
  return execution.tools.flatMap((t) => (isObj(t) && typeof t.id === 'string' ? [t.id] : []));
}

export interface UndeclaredTool {
  step: number;
  pointer: string;
  value: unknown;
}

/** Every non-blank step tool that is not exactly a declared tool ID (empty when the task conforms or nothing applies). */
export function undeclaredTools(execution: unknown, sections: unknown): UndeclaredTool[] {
  const ids = declaredToolIds(execution);
  if (!ids) return [];
  const declared = new Set(ids);
  const s = isObj(sections) ? sections[STEP_TOOL_SECTION] : undefined;
  const steps = isObj(s) && Array.isArray(s[STEP_TOOL_LIST]) ? (s[STEP_TOOL_LIST] as unknown[]) : [];
  const out: UndeclaredTool[] = [];
  steps.forEach((step, i) => {
    if (!isObj(step)) return;
    // D-016: a step's conditional follow-ups name tools too; each must be one the template declares.
    if (Array.isArray(step.followUps))
      step.followUps.forEach((f, j) => {
        if (!isObj(f) || !Array.isArray(f.tools)) return;
        f.tools.forEach((t, k) => {
          if (typeof t === 'string' && (t.trim() === '' || declared.has(t))) return;
          out.push({ step: i, pointer: `/sections/${STEP_TOOL_SECTION}/${STEP_TOOL_LIST}/${i}/followUps/${j}/tools/${k}`, value: t });
        });
      });
    if (step.tool === undefined || step.tool === null) return;
    const v = step.tool;
    if (typeof v === 'string' && (v.trim() === '' || declared.has(v))) return;
    out.push({ step: i, pointer: stepToolPointer(i), value: v });
  });
  return out;
}

/**
 * D-016: the step-tool guide's warnings as task checks (S5). Warnings, not blocks: the purpose match reads the step's
 * words, and a sensible step can be worded unusually. Undeclared tools stay blocking (undeclaredTools).
 */
export function stepToolChecks(execution: unknown, sections: unknown): TaskCheck[] {
  const offered = declaredToolIds(execution);
  if (!offered) return [];
  const s = isObj(sections) ? sections[STEP_TOOL_SECTION] : undefined;
  const steps = isObj(s) && Array.isArray(s[STEP_TOOL_LIST]) ? (s[STEP_TOOL_LIST] as unknown[]) : [];
  if (!steps.length) return [];
  return stepToolWarnings(steps, offered).map((w) => ({ id: `steps.tool.${w.code.toLowerCase()}.${w.step + 1}`, section: STEP_TOOL_SECTION, ok: false, severity: 'warning' as const, message: w.message }));
}

/** The author-facing message: which steps, which values, and the declared IDs to choose from. */
export function undeclaredToolMessage(problems: UndeclaredTool[], execution: unknown): string {
  const ids = declaredToolIds(execution) ?? [];
  const list = problems.map((p) => `step ${p.step + 1} "${typeof p.value === 'string' ? p.value : JSON.stringify(p.value)}"`).join(', ');
  return `${STEP_TOOL_SECTION} procedure ${problems.length === 1 ? 'step names a tool' : 'steps name tools'} this template does not declare (${list}). Use one of the template's tool IDs exactly (${ids.join(', ')}) or leave the tool blank.`;
}
