import { EXECUTABLE_WORKFLOW, praxisContractIssues, praxisContractChecks, kycCanonicalText, kycChecks, kycKeyInputs, type CoverageTags, type KycTask, type TaskCheck } from '@praxis/shared';

export interface TemplateRef {
  workflowName: string;
  /** The version's chosen authoring form (null = the workflow default). */
  profileId?: string | null;
  domainName: string;
  taskDefinitionSchema: unknown;
  collectionSchema: unknown;
  coverageDimensions: { key: string; label: string; values: string[] }[];
  edgeCases: string[];
}

export interface SlotRef {
  tags: Record<string, string>;
  edgeCase: string | null;
  isOpen: boolean;
}

/**
 * A workflow's task definition (SPEC: `validateTaskInput` / `validateSubmission`). Each workflow's definition is a
 * separate spec; KYC onboarding is the first (docs/TASK-KYC.md). Workflows without one use the generic definition,
 * which passes by default.
 */
export interface TaskDefinition {
  readonly key: string;
  /** Annotation inputs (upload or API push). */
  validateTaskInput(template: TemplateRef, data: unknown): string[];
  /** Workflow-specific automated checks on a submission. Common coverage checks are added by the task service. */
  validateSubmission(template: TemplateRef, output: Record<string, unknown>, slot: SlotRef | null): TaskCheck[];
  /** Plain text used for embeddings and the reviewer's side-by-side view. */
  canonicalText(output: Record<string, unknown>): string;
  /** Key inputs for the structured part of duplicate detection. */
  keyInputs(output: Record<string, unknown>): string[];
}

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

export const genericDefinition: TaskDefinition = {
  key: 'generic',
  validateTaskInput: (_t, data) => (data && typeof data === 'object' && !Array.isArray(data) ? [] : ['Each input must be a JSON object']),
  validateSubmission: (_t, output) => praxisContractChecks(output),
  canonicalText: (output) => strings(output).join('\n'),
  keyInputs: () => [],
};

const registry = new Map<string, TaskDefinition>();
/** Registers a workflow's definition, keyed by "domain / workflow" (case-insensitive). */
export function registerDefinition(domainName: string, workflowName: string, d: TaskDefinition) {
  registry.set(`${domainName} / ${workflowName}`.toLowerCase(), d);
}
/**
 * A template version that chose an alternate (sections) form uses the profile checks, not its workflow's own
 * definition: KYC v2 (account opening) is not checked as a KYC v1 workbench task (owner, 11 Nov 2026).
 */
export const definitionFor = (t: Pick<TemplateRef, 'domainName' | 'workflowName' | 'profileId'>): TaskDefinition =>
  t.profileId ? { ...genericDefinition, key: `profile:${t.profileId}` } : (registry.get(`${t.domainName} / ${t.workflowName}`.toLowerCase()) ?? genericDefinition);

/** Banking / KYC onboarding and refresh (docs/TASK-KYC.md). */
export const kycDefinition: TaskDefinition = {
  key: 'kyc-onboarding-v1',
  validateTaskInput: genericDefinition.validateTaskInput,
  validateSubmission: (_t, output, slot) => kycChecks(output as KycTask, slot),
  canonicalText: (output) => kycCanonicalText(output as KycTask),
  keyInputs: (output) => kycKeyInputs(output as KycTask),
};
registerDefinition('Banking', 'KYC onboarding and refresh', kycDefinition);

/** The author's header (common to all authoring definitions): coverage tags and edge case for open slots. */
export function authorCoverage(output: Record<string, unknown>): CoverageTags {
  const h = (output.header ?? {}) as { coverageTags?: Record<string, unknown>; edgeCase?: unknown };
  const tags = Object.fromEntries(Object.entries(h.coverageTags ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()]));
  return { tags, edgeCase: typeof h.edgeCase === 'string' && h.edgeCase.trim() ? h.edgeCase.trim() : null };
}

/** The slot's fixed tags always win over the author's; the author fills the rest. */
export function finalCoverage(slot: SlotRef | null, output: Record<string, unknown>): CoverageTags {
  const a = authorCoverage(output);
  return { tags: { ...a.tags, ...(slot?.tags ?? {}) }, edgeCase: slot?.edgeCase ?? a.edgeCase };
}

/** Common authoring checks: open slots must be tagged and name their edge case, with allowed values only. */
export function coverageChecks(template: TemplateRef, slot: SlotRef | null, output: Record<string, unknown>): TaskCheck[] {
  if (!slot) return [];
  const cov = finalCoverage(slot, output);
  const checks: TaskCheck[] = [];
  const bad = Object.entries(cov.tags).filter(([k, v]) => {
    const d = template.coverageDimensions.find((x) => x.key === k);
    return !d || (d.values.length > 0 && !d.values.some((x) => x.toLowerCase() === v.toLowerCase()));
  });
  checks.push({ id: 'coverage.values', section: 'W01', ok: bad.length === 0, message: bad.length ? `Unknown coverage values: ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}` : 'Coverage tags use the template’s values' });
  if (slot.isOpen) {
    checks.push({ id: 'coverage.open-tags', section: 'W01', ok: Object.keys(cov.tags).length > 0, message: 'Open slot: choose at least one coverage tag' });
    checks.push({ id: 'coverage.open-edge', section: 'W01', ok: !!cov.edgeCase, message: 'Open slot: name the edge case this task tests' });
  }
  return checks;
}

registerDefinition('Marketing', EXECUTABLE_WORKFLOW, { ...genericDefinition, key: 'praxis-contract-v1', validateTaskInput: (_t, input) => praxisContractIssues((input as Record<string, unknown> | null)?.praxisContract).map((i) => `${i.path}: ${i.message}`), validateSubmission: (_t, output) => praxisContractChecks(output, true) });
