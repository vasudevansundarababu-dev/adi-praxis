import { KYC_DISPOSITIONS, KYC_RISK, type KycTask } from '../kyc';
import { praxisContractIssues, PRAXIS_CONTRACT_VERSION, type PraxisTaskContract } from '../praxis-contract';
import { getFieldValue, isEmpty, profileApplies } from './helpers';
import type { TemplateProfileField, SectionKey, TemplateProfile } from './schema';

/**
 * Deterministic compiler from a profile-driven task output to an executable `praxis.anvil.task.v1` contract
 * (structured-decision-v1: one stage, one deliverable `output.json`). It never returns a partial contract: anything
 * it cannot map is a blocker with the exact source path, and a compiled contract always has zero
 * `praxisContractIssues`. Mapping choices are documented in docs/authoring/TEMPLATE-PROFILES.md.
 */

export interface ContractBlocker {
  code: string;
  /** Source path in the task output: `S7.criteria[1].outputField` (sections) or `rubric.criteria[1].outputField` (KYC). */
  path: string;
  message: string;
}
export type CompileResult = { contract: PraxisTaskContract } | { blockers: ContractBlocker[] };
export interface CompileIds {
  taskId: string;
  /** The exact revision the contract binds (`provenance.review.reviewed_revision_id`). */
  revisionId: string;
}

type Binding = PraxisTaskContract['constraints'][number]['binding'];
type Scalar = string | number | boolean;
interface OutputDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
  allowed: string[];
  description: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const COMPARISONS = new Set(['json_equals', 'json_number_min', 'json_number_max']);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const clip = (s: string) => (s.length > 20000 ? `${s.slice(0, 19990)} […]` : s);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const safeId = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 80);

/** Renders a record or list as readable lines (for evidence content). */
function render(v: unknown, indent = ''): string {
  if (Array.isArray(v)) return v.map((x) => (isObj(x) ? `${indent}- ${render(x, `${indent}  `).trimStart()}` : `${indent}- ${str(x)}`)).join('\n');
  if (isObj(v))
    return Object.entries(v)
      .filter(([, x]) => !isEmpty(x))
      .map(([k, x]) => (typeof x === 'object' ? `${indent}${k}:\n${render(x, `${indent}  `)}` : `${indent}${k}: ${str(x)}`))
      .join('\n');
  return `${indent}${str(v)}`;
}

class Builder {
  blockers: ContractBlocker[] = [];
  outputs = new Map<string, OutputDef>();
  reference: Record<string, Scalar> = {};
  block(code: string, path: string, message: string) {
    this.blockers.push({ code, path, message });
  }
  parse(def: OutputDef, raw: unknown, path: string, what: string): Scalar | undefined {
    if (isEmpty(raw)) {
      this.block(what === 'reference' ? 'MISSING_REFERENCE' : 'MISSING_BINDING', path, `${def.name}: the ${what} value is missing`);
      return undefined;
    }
    if (def.type === 'number') {
      const n = typeof raw === 'number' ? raw : Number(str(raw));
      if (!Number.isFinite(n)) return void this.block('INVALID_VALUE', path, `${def.name}: "${str(raw)}" is not a number`);
      return n;
    }
    if (def.type === 'boolean') {
      if (raw === true || raw === false) return raw;
      const s = str(raw).toLowerCase();
      if (s !== 'true' && s !== 'false') return void this.block('INVALID_VALUE', path, `${def.name}: write true or false`);
      return s === 'true';
    }
    const s = str(raw);
    if (def.allowed.length && !def.allowed.includes(s)) return void this.block('INVALID_VALUE', path, `${def.name}: "${s}" is not one of ${def.allowed.join(', ')}`);
    return s;
  }
  addOutput(def: OutputDef, referenceRaw: unknown, namePath: string, refPath: string) {
    if (!NAME.test(def.name)) return this.block('INVALID_ID', namePath, `"${def.name}" is not a valid output field name (letters, digits, underscores)`);
    if (this.outputs.has(def.name)) return this.block('DUPLICATE_OUTPUT_FIELD', namePath, `Output field ${def.name} is declared twice`);
    this.outputs.set(def.name, def);
    const v = this.parse(def, referenceRaw, refPath, 'reference');
    if (v !== undefined) this.reference[def.name] = v;
  }
  binding(src: Record<string, unknown>, path: string): Binding | undefined {
    const field = str(src.outputField);
    if (!field) return void this.block('MISSING_BINDING', `${path}.outputField`, 'Name the output field this rule or criterion checks');
    const def = this.outputs.get(field);
    if (!def) return void this.block('UNKNOWN_OUTPUT_FIELD', `${path}.outputField`, `${field} is not a declared output field`);
    const kind = str(src.comparison);
    if (!COMPARISONS.has(kind)) return void this.block('MISSING_BINDING', `${path}.comparison`, 'Choose equals, at least or at most');
    if (kind !== 'json_equals' && def.type !== 'number') return void this.block('INVALID_BINDING', `${path}.comparison`, `${field} is not a number, so only equals applies`);
    const value = this.parse(def, src.expectedValue, `${path}.expectedValue`, 'expected');
    if (value === undefined) return undefined;
    const b = { kind, field, value } as Binding;
    const ref = this.reference[field];
    if (ref !== undefined) {
      const ok = kind === 'json_equals' ? ref === value : typeof ref === 'number' && (kind === 'json_number_min' ? ref >= (value as number) : ref <= (value as number));
      if (!ok) this.block('REFERENCE_FAILS_RULE', path, `The reference value of ${field} (${String(ref)}) does not satisfy this check`);
    }
    return b;
  }
  describeOutputs() {
    return [...this.outputs.values()].map((d) => `${d.name} (${d.type}${d.allowed.length ? `: ${d.allowed.join(', ')}` : ''})`).join(', ');
  }
}

/**
 * Owner, 12 Nov: failing a critical criterion fails the whole task. Anvil's task contract expresses that as a
 * constraint with hard_failure, bound exactly like the criterion; the criterion keeps its weight for scoring.
 */
function criticalConstraint(id: string, description: string, binding: Binding): PraxisTaskContract['constraints'][number] {
  return { id: `${id.slice(0, 70)}.critical`, description: clip(`Critical (failing it fails the task): ${description}`), hard_failure: true, binding };
}

function finish(b: Builder, ids: CompileIds, parts: { title: string; objective: string; taskVersion: string; source: string; evidence: PraxisTaskContract['evidence']; constraints: PraxisTaskContract['constraints']; criteria: PraxisTaskContract['rubric']['criteria']; initialState: Record<string, unknown> }): CompileResult {
  if (!ID.test(ids.taskId)) b.block('INVALID_ID', 'taskId', 'The task ID is not a valid contract ID');
  if (!ID.test(ids.revisionId)) b.block('INVALID_ID', 'revisionId', 'The revision ID is not a valid contract ID');
  if (!b.outputs.size) b.block('NO_OUTPUT_FIELDS', 'outputs', 'The task declares no output fields');
  if (!parts.criteria.length && !b.blockers.some((x) => x.code === 'MISSING_BINDING')) b.block('NO_CRITERIA', 'criteria', 'Add at least one criterion with an output field');
  const total = parts.criteria.reduce((n, c) => n + c.weight_bps, 0);
  if (parts.criteria.length && total !== 10000) b.block('WEIGHTS', 'criteria', `Criterion weights must total 100 (now ${total / 100})`);
  const actor = parts.evidence.filter((e) => e.visibility === 'actor');
  if (!actor.length) b.block('NO_EVIDENCE', 'evidence', 'The agent has no evidence to inspect');
  if (b.blockers.length) return { blockers: b.blockers };
  const contract: PraxisTaskContract = {
    schema_version: PRAXIS_CONTRACT_VERSION as 'praxis.anvil.task.v1',
    task_id: ids.taskId,
    task_version: parts.taskVersion,
    revision_id: ids.revisionId,
    title: clip(parts.title),
    objective: clip(`${parts.objective}\n\nWrite /workspace/output.json with ${b.describeOutputs()}.`),
    evidence: parts.evidence,
    constraints: parts.constraints,
    environment: { binding: 'structured-decision-v1', initial_state: parts.initialState },
    actions: [{ id: 'action-submit', description: 'Write the final JSON decision to /workspace/output.json; there are no external side effects.' }],
    stages: [{ id: 'stage-decision', instruction: 'Inspect the supplied evidence and submit the decision.', evidence_ids: actor.map((e) => e.id), completion: 'Write /workspace/output.json' }],
    deliverables: [{ id: 'deliverable-output', path: 'output.json', description: clip(`JSON object with ${b.describeOutputs()}.`) }],
    rubric: { criteria: parts.criteria, reference_output: b.reference },
    provenance: {
      classification: 'synthetic',
      source: clip(parts.source),
      rights: { status: 'declared', basis: 'The author declared at submission that the case is synthetic, authorised test data with no real customer or employer information. Not a reviewed rights clearance.' },
      review: { status: 'draft', reviewer_ref: 'pending-praxis-review', reviewed_revision_id: ids.revisionId },
    },
  };
  const issues = praxisContractIssues(contract);
  if (issues.length) return { blockers: issues.map((i) => ({ code: 'CONTRACT_INVALID', path: `contract.${i.path}`, message: i.message })) };
  return { contract };
}

function evidenceId(b: Builder, raw: unknown, path: string, taken: Set<string>): string | null {
  const id = str(raw);
  if (!ID.test(id)) {
    b.block('INVALID_ID', path, `"${id}" is not a valid evidence ID`);
    return null;
  }
  if (taken.has(id)) {
    b.block('DUPLICATE_ID', path, `ID ${id} is used twice`);
    return null;
  }
  taken.add(id);
  return id;
}

// ───────────────────────── sections profiles ─────────────────────────

function compileSections(profile: TemplateProfile, output: Record<string, unknown>, ids: CompileIds): CompileResult {
  const map = profile.contract!;
  const b = new Builder();
  const fieldOf = (ref: string): { section: SectionKey; field: TemplateProfileField } => {
    const [sk, key] = ref.split('.') as [SectionKey, string];
    return { section: sk, field: profile.sections.find((s) => s.key === sk)!.fields.find((f) => f.key === key)! };
  };
  const value = (ref: string) => {
    const { section, field } = fieldOf(ref);
    return getFieldValue(profile, output, section, field);
  };

  const title = str(value(`S1.${profile.titleField}`));
  if (!title) b.block('MISSING_FIELD', `S1.${profile.titleField}`, 'The task needs a title');
  const objective = map.objective.map((r) => str(value(r))).filter(Boolean).join('\n\n');
  if (!objective) b.block('MISSING_FIELD', map.objective[0]!, 'The agent brief is empty');

  // Output fields: the template's S6 outcome fields, then the author's declared fields.
  const s6 = profile.sections.find((s) => s.key === 'S6')!;
  for (const f of s6.fields.filter((x) => x.outputField))
    b.addOutput({ name: f.outputField!, type: f.type === 'number' ? 'number' : 'string', allowed: f.type === 'pick_list' ? (f.options ?? []).map((o) => o.value) : [], description: f.label }, getFieldValue(profile, output, 'S6', f), `S6.${f.key}`, `S6.${f.key}`);
  if (map.decisionFields)
    list(value(map.decisionFields)).forEach((item, i) => {
      const p = `${map.decisionFields}[${i}]`;
      if (!isObj(item)) return b.block('INVALID_VALUE', p, 'Output field must be a record');
      const type = str(item.valueType);
      if (type !== 'string' && type !== 'number' && type !== 'boolean') return b.block('MISSING_FIELD', `${p}.valueType`, 'Choose the output field type');
      const allowed = type === 'string' ? list(item.allowedValues).map(str).filter(Boolean) : [];
      b.addOutput({ name: str(item.name), type, allowed, description: str(item.description) }, item.referenceValue, `${p}.name`, `${p}.referenceValue`);
    });

  // Evidence: actor inputs, recorded responses (supplied up front: structured-decision-v1 has no tool replay), then private notes.
  const taken = new Set<string>();
  const evidence: PraxisTaskContract['evidence'] = [];
  for (const ref of map.actorEvidence) {
    const { field } = fieldOf(ref);
    const v = value(ref);
    if (field.type === 'evidence_record') {
      list(v).forEach((item, i) => {
        if (!isObj(item)) return;
        const id = evidenceId(b, item.id, `${ref}[${i}].id`, taken);
        const content = [`${str(item.type) || 'record'}${item.source ? ` · source: ${str(item.source)}` : ''}${item.date ? ` · date: ${str(item.date)}` : ''}`, str(item.content)].filter(Boolean).join('\n');
        if (!str(item.content)) b.block('MISSING_FIELD', `${ref}[${i}].content`, 'Evidence content is empty');
        else if (id) evidence.push({ id, visibility: 'actor', content: clip(content) });
      });
    } else if (!isEmpty(v)) {
      const id = `ev-${safeId(field.key)}`;
      taken.add(id);
      evidence.push({ id, visibility: 'actor', content: clip(`${field.label}:\n${render(v)}`) });
    }
  }
  if (getFieldValue(profile, output, 'S3', { key: 'environment' }) === 'recorded_tools')
    list(getFieldValue(profile, output, 'S3', { key: 'recordedResponses' })).forEach((item, i) => {
      if (!isObj(item)) return;
      const id = evidenceId(b, item.id, `S3.recordedResponses[${i}].id`, taken);
      if (id) evidence.push({ id, visibility: 'actor', content: clip(`Recorded result of ${str(item.tool)} (${str(item.arguments)}):\n${str(item.response)}`) });
    });

  // Policies: a cited rule with a binding is a constraint; one without stays agent context.
  const constraints: PraxisTaskContract['constraints'] = [];
  if (map.policies)
    list(value(map.policies)).forEach((item, i) => {
      const p = `${map.policies}[${i}]`;
      if (!isObj(item)) return;
      const ruleId = str(item.ruleId);
      const id = `policy-${safeId(ruleId)}`;
      const text = `${ruleId} v${str(item.ruleVersion)} (${str(item.locator)})${item.quote ? `: ${str(item.quote)}` : ''}`;
      if (taken.has(id)) return b.block('DUPLICATE_ID', `${p}.ruleId`, `Rule ${ruleId} is cited twice`);
      taken.add(id);
      if (isEmpty(item.outputField)) return void evidence.push({ id, visibility: 'actor', content: clip(`Applicable rule ${text}`) });
      const binding = b.binding(item, p);
      if (binding) constraints.push({ id, description: clip(text), hard_failure: item.hardFailure === true, binding });
    });

  for (const ref of map.privateEvidence) {
    const v = str(value(ref));
    if (v) evidence.push({ id: `private-${safeId(fieldOf(ref).field.key)}`, visibility: 'private', content: clip(`${fieldOf(ref).field.label}: ${v}`) });
  }

  const criteria: PraxisTaskContract['rubric']['criteria'] = [];
  list(value(map.criteria)).forEach((item, i) => {
    const p = `${map.criteria}[${i}]`;
    if (!isObj(item)) return;
    const id = str(item.id);
    if (!ID.test(id)) return b.block('INVALID_ID', `${p}.id`, `"${id}" is not a valid criterion ID`);
    const weight = typeof item.weight === 'number' ? item.weight : NaN;
    if (!(weight > 0) || !Number.isInteger(weight * 100)) return b.block('INVALID_VALUE', `${p}.weight`, 'Weight must be a positive number with at most two decimals');
    const binding = b.binding(item, p);
    if (!binding) return;
    const description = clip([str(item.name), str(item.passCondition)].filter(Boolean).join(': ') || id);
    criteria.push({ id, description, weight_bps: Math.round(weight * 100), binding });
    if (item.critical === true) constraints.push(criticalConstraint(id, description, binding));
  });

  return finish(b, ids, {
    title,
    objective,
    taskVersion: `${profile.profileId}.v${profile.version}`,
    source: `Praxis authored task (template profile ${profile.profileId} v${profile.version}, ${profile.catalogWorkflowName}). Synthetic case written by a Praxis expert.`,
    evidence,
    constraints,
    criteria,
    initialState: { synthetic: true, profile_id: profile.profileId, profile_version: profile.version },
  });
}

// ───────────────────────── KYC (existing workbench contract) ─────────────────────────

/** Compiles the KYC workbench output (`KycTask`). Output fields: disposition and risk_rating. */
export function compileKycContract(task: KycTask, ids: CompileIds, profileVersion = 1): CompileResult {
  const b = new Builder();
  const title = str(task.header?.title);
  if (!title) b.block('MISSING_FIELD', 'header.title', 'The task needs a title');
  const objective = str(task.scenario?.businessContext);
  if (!objective) b.block('MISSING_FIELD', 'scenario.businessContext', 'The agent brief is empty');
  b.addOutput({ name: 'disposition', type: 'string', allowed: [...KYC_DISPOSITIONS], description: 'Recommended disposition' }, task.solution?.disposition, 'solution.disposition', 'solution.disposition');
  b.addOutput({ name: 'risk_rating', type: 'string', allowed: [...KYC_RISK], description: 'Risk rating' }, task.solution?.riskRating, 'solution.riskRating', 'solution.riskRating');

  const taken = new Set<string>(['ev-case', 'ev-parties', 'ev-ownership']);
  const evidence: PraxisTaskContract['evidence'] = [];
  const scenario = { trigger: task.scenario?.trigger, customerType: task.scenario?.customerType, product: task.scenario?.product, channel: task.scenario?.channel, jurisdiction: task.header?.jurisdiction, language: task.header?.language, statedPurpose: task.customerFile?.statedPurpose, expectedActivity: task.customerFile?.expectedActivity };
  if (Object.values(scenario).some((v) => !isEmpty(v))) evidence.push({ id: 'ev-case', visibility: 'actor', content: clip(`Case file:\n${render(scenario)}`) });
  if (task.customerFile?.parties?.length) evidence.push({ id: 'ev-parties', visibility: 'actor', content: clip(`Parties:\n${render(task.customerFile.parties)}`) });
  if (task.customerFile?.ownership?.length) evidence.push({ id: 'ev-ownership', visibility: 'actor', content: clip(`Ownership:\n${render(task.customerFile.ownership)}`) });
  (task.evidence?.documents ?? []).forEach((d, i) => {
    const id = evidenceId(b, d.id, `evidence.documents[${i}].id`, taken);
    const { defects: _defects, ...visible } = d;
    void _defects;
    if (id) evidence.push({ id, visibility: 'actor', content: clip(`Document:\n${render(visible)}`) });
  });
  (task.environment?.responses ?? []).forEach((r, i) => {
    const id = evidenceId(b, r.id, `environment.responses[${i}].id`, taken);
    if (id) evidence.push({ id, visibility: 'actor', content: clip(`Recorded result of ${r.tool} (${r.input || render(r.arguments ?? {})}), ${r.kind}:\n${r.response}`) });
  });
  (task.policy?.rules ?? []).forEach((r, i) => {
    const id = `policy-${safeId(r.id)}`;
    if (taken.has(id)) return b.block('DUPLICATE_ID', `policy.rules[${i}].id`, `Rule ${r.id} is listed twice`);
    taken.add(id);
    if (str(r.text)) evidence.push({ id, visibility: 'actor', content: clip(`Applicable rule ${r.id}: ${r.text}`) });
  });
  const defects = (task.evidence?.documents ?? []).flatMap((d) => (d.defects ?? []).map((x) => `${d.id}: ${x}`));
  if (defects.length) evidence.push({ id: 'private-defects', visibility: 'private', content: clip(`Document defects:\n${defects.join('\n')}`) });
  if (str(task.solution?.rationale)) evidence.push({ id: 'private-rationale', visibility: 'private', content: clip(`Reference rationale: ${str(task.solution?.rationale)}`) });

  const criteria: PraxisTaskContract['rubric']['criteria'] = [];
  const kycConstraints: PraxisTaskContract['constraints'] = [];
  (task.rubric?.criteria ?? []).forEach((c, i) => {
    const p = `rubric.criteria[${i}]`;
    if (!ID.test(str(c.id))) return b.block('INVALID_ID', `${p}.id`, `"${str(c.id)}" is not a valid criterion ID`);
    if (!(c.weight > 0) || !Number.isInteger(c.weight * 100)) return b.block('INVALID_VALUE', `${p}.weight`, 'Weight must be a positive number with at most two decimals');
    const binding = b.binding(c as unknown as Record<string, unknown>, p);
    if (!binding) return;
    const description = clip([c.name, c.passCondition].filter(Boolean).join(': '));
    criteria.push({ id: c.id, description, weight_bps: Math.round(c.weight * 100), binding });
    if (c.critical === true) kycConstraints.push(criticalConstraint(c.id, description, binding));
  });

  return finish(b, ids, {
    title,
    objective,
    taskVersion: `kyc-onboarding-and-refresh.v${profileVersion}`,
    source: 'Praxis authored task (KYC onboarding and refresh workbench). Synthetic case written by a Praxis expert.',
    evidence,
    constraints: kycConstraints,
    criteria,
    initialState: { synthetic: true, profile_id: 'kyc-onboarding-and-refresh', profile_version: profileVersion, available_tools: task.environment?.tools ?? [] },
  });
}

/** Export readiness stored with a profile-driven submission. */
export interface ExportStatusView {
  status: 'ready' | 'blocked';
  blockers: ContractBlocker[];
}

/** "Approved; export adapter blocked: <reason>" for the task view and review screen. Null when not applicable. */
export function exportStatusLine(statusLabel: string, s: ExportStatusView | null | undefined): string | null {
  if (!s) return null;
  if (s.status === 'ready') return `${statusLabel}; export adapter ready (praxis.anvil.task.v1)`;
  const [first, ...rest] = s.blockers;
  return `${statusLabel}; export adapter blocked: ${first ? `${first.message} (${first.path})` : 'unknown reason'}${rest.length ? ` and ${rest.length} more` : ''}`;
}

/** Compiles a task output for its profile. KYC (canonical storage) uses the KYC compiler. */
export function compilePraxisContract(profile: TemplateProfile, output: unknown, ids: CompileIds): CompileResult {
  if (!profileApplies(profile, output)) return { blockers: [{ code: 'PROFILE_NOT_APPLICABLE', path: 'profile', message: `This output was not authored with the ${profile.profileId} profile` }] };
  if (profile.storage === 'canonical') {
    if (profile.profileId === 'kyc-onboarding-and-refresh') return compileKycContract(output as KycTask, ids, profile.version);
    return { blockers: [{ code: 'NO_COMPILER', path: 'profile', message: `No contract compiler for ${profile.profileId}` }] };
  }
  return compileSections(profile, output as Record<string, unknown>, ids);
}
