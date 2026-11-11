import { agentProjection, compilePraxisContract, profileApplies, profileForTemplate, profileProblems, profileShapeProblems, type ContractBlocker, type TaskCheck, type TemplateProfile } from '@praxis/shared';

/**
 * Server side of the template profile registry (handover v2.1 ch. 05): save-time shape checks, submission checks,
 * the agent projection and the Anvil contract compiled at submission. Only outputs that carry `profile` (or the
 * canonical KYC contract) are touched; legacy generic outputs keep their old behaviour.
 */

/** A template version's form: its workflow name and the profile it chose (null = the workflow default). A bare name
 * means the workflow default. */
export type TemplateForm = string | { workflowName: string; profileId?: string | null };
const formOf = (f: TemplateForm) => (typeof f === 'string' ? { workflowName: f, profileId: null } : f);

/** The registered profile of a template version, if it is supported. */
export function profileFor(form: TemplateForm): TemplateProfile | null {
  const r = profileForTemplate(formOf(form));
  return r.status === 'ok' ? r.profile : null;
}

/** A profile whose values live in `output.sections` (every Wave 1 profile except KYC). */
export function sectionsProfileFor(workflowName: TemplateForm): TemplateProfile | null {
  const p = profileFor(workflowName);
  return p?.storage === 'sections' ? p : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Problems that block a save. Outputs without `profile` are legacy and pass unchanged. */
export function profileSaveProblems(workflowName: TemplateForm, output: Record<string, unknown>): string[] {
  if (!Object.hasOwn(output, 'profile')) return [];
  const p = sectionsProfileFor(workflowName);
  if (!p) return [`${formOf(workflowName).workflowName} has no template profile; save the task without a profile reference`];
  return profileShapeProblems(p, output);
}

/** Required and conditional profile checks for a profile-driven output, one check per problem. */
export function profileChecks(workflowName: TemplateForm, output: Record<string, unknown>): TaskCheck[] {
  const p = sectionsProfileFor(workflowName);
  if (!p || !profileApplies(p, output)) return [];
  const problems = profileProblems(p, output);
  if (!problems.length) return [{ id: 'profile.complete', section: 'S8', ok: true, message: `Every required field of the ${p.catalogWorkflowName} profile is complete` }];
  return problems.map((x) => ({ id: `profile.${x.path}`, section: x.section, ok: false, message: x.message }));
}

/** The agent view of a profile-driven output, or null to fall back to the legacy view. */
export function profileAgentView(workflowName: TemplateForm, output: Record<string, unknown>): Record<string, unknown> | null {
  const p = sectionsProfileFor(workflowName);
  return p ? agentProjection(p, output) : null;
}

export interface ExportStatus {
  status: 'ready' | 'blocked';
  profile: { id: string; version: number };
  blockers: ContractBlocker[];
}

/** Marker stored next to a compiled contract so it is recognised (and replaced) on the next submission. */
export const COMPILED_MARKER = 'praxisContractCompiled';

/**
 * Compiles the contract for a submission. Returns the output to store (contract added, or a stale compiled contract
 * removed) and the export status, or null when the task is not profile-driven. Never blocks the submission.
 */
export function compileForSubmission(workflowName: TemplateForm, output: Record<string, unknown>, ids: { taskId: string; revisionId: string }): { output: Record<string, unknown>; status: ExportStatus } | null {
  const p = profileFor(workflowName);
  if (!p || !profileApplies(p, output)) return null;
  // A hand-written executable contract (generic legacy editor) is never replaced.
  if (Object.hasOwn(output, 'praxisContract') && !isObj(output[COMPILED_MARKER])) return null;
  const { praxisContract: _old, [COMPILED_MARKER]: _marker, ...rest } = output;
  void _old;
  void _marker;
  const r = compilePraxisContract(p, rest, ids);
  const profile = { id: p.profileId, version: p.version };
  if ('blockers' in r) return { output: rest, status: { status: 'blocked', profile, blockers: r.blockers } };
  return { output: { ...rest, praxisContract: r.contract, [COMPILED_MARKER]: { ...profile, revisionId: ids.revisionId } }, status: { status: 'ready', profile, blockers: [] } };
}
