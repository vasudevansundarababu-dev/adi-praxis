import { benchmarkInputProblems, edgeCasesOf, sliceLists, TaskBenchmarkInput, templateVerifiers, type EdgeCase, type TemplateVerifiers } from '@praxis/shared';
import type { Template } from '@prisma/client';
import { jointParts } from './joint-template';

/**
 * Studio's edge cases, slice tags and verifiers on a template version (AUTHORING-SPEC 1-2), as Authoring shows,
 * collects and exports them. Read from the joint proposal parts stored verbatim on the version (`Template.anvilSpec`).
 */
export interface TemplateBenchmark {
  edgeCases: EdgeCase[];
  sliceLists: { complexity: string[]; archetype: string[] };
  verifiers: TemplateVerifiers | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function templateBenchmark(t: Pick<Template, 'anvilSpec'>): TemplateBenchmark {
  const parts = jointParts(t);
  if (!parts) return { edgeCases: [], sliceLists: { complexity: [], archetype: [] }, verifiers: null };
  return { edgeCases: edgeCasesOf(parts.authoring.edge_cases), sliceLists: sliceLists(parts.authoring.profile), verifiers: templateVerifiers(parts) };
}

/** A task's stored benchmark input (TaskInstance.benchmark), or the empty input. `version` counts saves. */
export function taskBenchmarkOf(v: unknown): TaskBenchmarkInput & { version: number } {
  const parsed = TaskBenchmarkInput.safeParse(isObj(v) ? { edgeCase: v.edgeCase ?? null, slots: v.slots ?? {}, extraStateChecks: v.extraStateChecks ?? [], ...(isObj(v.familyFocus) ? { familyFocus: v.familyFocus } : {}) } : {});
  const version = isObj(v) && Number.isInteger(v.version) ? (v.version as number) : 0;
  return { ...(parsed.success ? parsed.data : { edgeCase: null, slots: {}, extraStateChecks: [] }), version };
}

/** Problems that stop approval (spec 2.4): required slots, choices, allowed checks, a known edge case. */
export function approvalProblems(t: Pick<Template, 'anvilSpec'>, benchmark: unknown): string[] {
  const b = templateBenchmark(t);
  if (!b.edgeCases.length && !b.verifiers) return [];
  return benchmarkInputProblems(taskBenchmarkOf(benchmark), b, { forApproval: true });
}

/**
 * What a task's package adds to its private part (spec 1.6, 2.4; RL Gym 2.12 reads `complexity` and `archetype` from
 * the private part). Keys appear only when they have a value, so packages of templates without edge cases or
 * verifiers keep their exact bytes and hashes.
 * - complexity, archetype: the S1 values; a focused edge case supplies its archetype (and complexity when S1 has none).
 * - edge_case: the focused edge case's tag.
 * - verifiers: `sme` templates only, the slot values and extra state checks. Never in the actor part.
 */
export function benchmarkPrivatePart(t: Pick<Template, 'anvilSpec'>, sections: unknown, benchmark: unknown): Record<string, unknown> {
  const b = templateBenchmark(t);
  const input = taskBenchmarkOf(benchmark);
  const s1 = isObj(sections) && isObj(sections.S1) ? sections.S1 : {};
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const edge = input.edgeCase ? b.edgeCases.find((e) => e.tag === input.edgeCase) ?? null : null;
  const complexity = text(s1.complexity) ?? edge?.complexity ?? null;
  const archetype = edge?.archetype ?? text(s1.archetype);
  const out: Record<string, unknown> = {};
  if (complexity) out.complexity = complexity;
  if (archetype) out.archetype = archetype;
  if (edge) out.edge_case = edge.tag;
  if (b.verifiers?.expectedValuesFrom === 'sme' && (Object.keys(input.slots).length || input.extraStateChecks.length)) out.verifiers = { slots: input.slots, extra_state_checks: input.extraStateChecks };
  return out;
}
