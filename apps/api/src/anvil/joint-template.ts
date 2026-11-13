import { GOLDEN_PACK_SCHEMA_VERSION } from '@praxis/shared';
import type { Template } from '@prisma/client';
import { jcsSha256 } from './jcs';

/**
 * The joint template object both sides hash (Anvil's four confirmations, 11 Nov 2026, point 1):
 * `praxis.anvil.template-spec.v1` with exactly eight top-level keys. Anvil proposes the key and the parts; Praxis
 * assigns `template_id` (the stable template lineage UUID) and the integer `version`, and a Praxis Admin publishes.
 * The parts are kept exactly as received (no defaults, coercion or Unicode normalisation), so both sides compute the
 * same hashes.
 */
export const JOINT_TEMPLATE_SPEC = 'praxis.anvil.template-spec.v1' as const;
export const JOINT_KEYS = ['schemaVersion', 'anvil_template_key', 'template_id', 'version', 'requirement', 'authoring', 'execution', 'skills'] as const;
const PROPOSAL_KEYS = new Set(['schemaVersion', 'anvil_template_key', 'requirement', 'authoring', 'execution', 'skills']);
const IDENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

export interface JointTemplateSpec {
  schemaVersion: typeof JOINT_TEMPLATE_SPEC;
  anvil_template_key: string;
  template_id: string;
  version: number;
  requirement: Record<string, unknown>;
  authoring: { profile: Record<string, unknown>; template?: Record<string, unknown>; examples?: unknown[] };
  execution: Record<string, unknown>;
  skills: Record<string, unknown>;
}

/** What Praxis stores on the template version (`Template.anvilSpec`) for a joint proposal: the parts, verbatim. */
export interface StoredJointParts {
  schemaVersion: typeof JOINT_TEMPLATE_SPEC;
  anvil_template_key: string;
  requirement: Record<string, unknown>;
  authoring: JointTemplateSpec['authoring'];
  execution: Record<string, unknown>;
  skills: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Execution part schemas Praxis stores (unchanged) for a joint proposal. v2: KYC five-state contract, K5. */
export const EXECUTION_SCHEMAS: readonly string[] = ['anvil.template-execution.v1', 'anvil.template-execution.v2'];

export const isJointProposal = (body: unknown) => isObj(body) && body.schemaVersion === JOINT_TEMPLATE_SPEC;
export const jointParts = (t: Pick<Template, 'anvilSpec'>): StoredJointParts | null => (isObj(t.anvilSpec) && t.anvilSpec.schemaVersion === JOINT_TEMPLATE_SPEC ? (t.anvilSpec as unknown as StoredJointParts) : null);

export interface JointIssue {
  code: string;
  owner: 'anvil';
  file: 'template-spec.json';
  pointer: string;
  message: string;
  fix: string;
}
const issue = (code: string, pointer: string, message: string, fix: string): JointIssue => ({ code, owner: 'anvil', file: 'template-spec.json', pointer, message, fix });

/**
 * Shape checks of a joint proposal (Praxis's side only: Praxis owns the authoring schema; the execution and skills
 * parts are Anvil's and are checked here only for what Praxis relies on). Returns the golden pack built from the
 * authoring part so the existing form checks and draft creation apply unchanged.
 */
export function checkJointProposal(body: Record<string, unknown>): { issues: JointIssue[]; parts: StoredJointParts | null; pack: Record<string, unknown> | null } {
  const issues: JointIssue[] = [];
  for (const k of Object.keys(body)) {
    if (k === 'template_id' || k === 'version') issues.push(issue('TP_SPEC_SHAPE', `/${k}`, `${k} is assigned by Praxis when the draft is created; a proposal does not carry it.`, `Remove ${k}; Praxis returns the assigned template_id and version.`));
    else if (!PROPOSAL_KEYS.has(k)) issues.push(issue('TP_SPEC_SHAPE', `/${k}`, `Unknown top-level field "${k}".`, 'Send only schemaVersion, anvil_template_key, requirement, authoring, execution and skills.'));
  }
  if (typeof body.anvil_template_key !== 'string' || !IDENT.test(body.anvil_template_key)) issues.push(issue('TP_SPEC_SHAPE', '/anvil_template_key', 'anvil_template_key must be an identifier (letters, digits, dot, dash, underscore; at most 80).', 'Send Anvil’s stable proposal key.'));
  if (!isObj(body.requirement) || !Object.keys(body.requirement).length) issues.push(issue('TP_SPEC_SHAPE', '/requirement', 'requirement must be a non-empty reference object.', 'Send the approved requirement reference (no confidential customer requirements or personnel records).'));
  const a = body.authoring;
  if (!isObj(a)) issues.push(issue('TP_SPEC_SHAPE', '/authoring', 'authoring must be an object {profile, template?, examples?}.', 'Wrap the form as authoring.profile.'));
  else {
    for (const k of Object.keys(a)) if (!['profile', 'template', 'examples'].includes(k)) issues.push(issue('TP_SPEC_SHAPE', `/authoring/${k}`, `Unknown authoring field "${k}".`, 'authoring holds only profile, template and examples.'));
    if (!isObj(a.profile)) issues.push(issue('TP_SPEC_SHAPE', '/authoring/profile', 'authoring.profile is required.', 'Send the praxis.template_profile.v1 form.'));
    if (a.template !== undefined && !isObj(a.template)) issues.push(issue('TP_SPEC_SHAPE', '/authoring/template', 'authoring.template must be an object.', 'Send the template block or omit it.'));
    if (a.examples !== undefined && !Array.isArray(a.examples)) issues.push(issue('TP_SPEC_SHAPE', '/authoring/examples', 'authoring.examples must be an array.', 'Send the worked examples as an array or omit it.'));
  }
  const ex = body.execution;
  if (!isObj(ex) || !EXECUTION_SCHEMAS.includes(ex.schema_version as string)) issues.push(issue('TP_SPEC_SHAPE', '/execution/schema_version', `execution must be an ${EXECUTION_SCHEMAS.join(' or ')} object.`, 'Send the execution part in Anvil’s published schema.'));
  else {
    // K5 (12 Nov 2026): v2 carries template-level federal policies as immutable references; bank rules stay in `rules`.
    if (ex.schema_version === 'anvil.template-execution.v2') {
      const fp = ex.federalPolicies;
      if (!Array.isArray(fp) || !fp.length) issues.push(issue('TP_SPEC_SHAPE', '/execution/federalPolicies', 'anvil.template-execution.v2 needs federalPolicies.', 'List each federal policy as {id, version, content_sha256, publication_ref}.'));
      else
        fp.forEach((f, i) => {
          const ok = isObj(f) && typeof f.id === 'string' && !!f.id && typeof f.version === 'string' && !!f.version && typeof f.content_sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.content_sha256) && typeof f.publication_ref === 'string' && !!f.publication_ref;
          if (!ok) issues.push(issue('TP_SPEC_SHAPE', `/execution/federalPolicies/${i}`, 'A federal policy must be {id, version, content_sha256 (64 lowercase hex), publication_ref}.', 'Send the exact immutable reference; never an invented hash.'));
        });
    }
    if (ex.paid_calls !== false) issues.push(issue('TP_SPEC_SHAPE', '/execution/paid_calls', 'paid_calls must be false.', 'Paid calls are off for every Praxis template.'));
    if (!Array.isArray(ex.evaluators) || !ex.evaluators.length) issues.push(issue('TP_EVALUATOR_KIND_UNKNOWN', '/execution/evaluators', 'No evaluator mapping: authored criteria could not be graded.', 'Map each criterion ID to a catalogue capability {id, version} and evidence_source.'));
    if (!isObj(ex.output_schema) || ex.output_schema.type !== 'object') issues.push(issue('TP_OUTPUT_SCHEMA', '/execution/output_schema', 'The final-answer schema must be an object schema.', 'Provide the output schema of the final answer.'));
  }
  const sk = body.skills;
  if (!isObj(sk) || sk.schema_version !== 'anvil.template-skills.v1') issues.push(issue('TP_SPEC_SHAPE', '/skills/schema_version', 'skills must be an anvil.template-skills.v1 object.', 'Send the skills part in Anvil’s published schema.'));
  else
    for (const role of ['authoring', 'reviewing'] as const) {
      const m = isObj(sk[role]) ? (sk[role] as { mandatory?: unknown }).mandatory : undefined;
      if (!Array.isArray(m) || !m.length) issues.push(issue('TP_SKILLS_MISSING', `/skills/${role}/mandatory`, `No mandatory ${role} skills: Praxis cannot generate the job description.`, `List at least one mandatory ${role} skill.`));
    }
  if (issues.length || !isObj(a)) return { issues, parts: null, pack: null };
  const parts: StoredJointParts = {
    schemaVersion: JOINT_TEMPLATE_SPEC,
    anvil_template_key: body.anvil_template_key as string,
    requirement: body.requirement as Record<string, unknown>,
    authoring: a as StoredJointParts['authoring'],
    execution: ex as Record<string, unknown>,
    skills: sk as Record<string, unknown>,
  };
  const pack = { schemaVersion: GOLDEN_PACK_SCHEMA_VERSION, source: `Anvil template ${parts.anvil_template_key}`, profile: a.profile, ...(a.template !== undefined ? { template: a.template } : {}), ...(a.examples !== undefined ? { examples: a.examples } : {}) };
  return { issues, parts, pack };
}

/** Tool IDs the execution part describes (joint shape: `tools[].id`). */
export const jointToolIds = (parts: Pick<StoredJointParts, 'execution'>) => ((parts.execution.tools as { id?: unknown }[] | undefined) ?? []).map((t) => String(t.id));

/** The joint object for a template version: Praxis's identity and version filled in, parts exactly as stored. */
export function jointTemplateSpec(t: Pick<Template, 'lineageId' | 'version' | 'anvilSpec'>): JointTemplateSpec | null {
  const p = jointParts(t);
  if (!p) return null;
  return { schemaVersion: JOINT_TEMPLATE_SPEC, anvil_template_key: p.anvil_template_key, template_id: t.lineageId, version: t.version, requirement: p.requirement, authoring: p.authoring, execution: p.execution, skills: p.skills };
}

/** template_sha256 and part_hashes, each JCS SHA-256 of the complete object or part. */
export function jointHashes(spec: JointTemplateSpec) {
  return { template_sha256: jcsSha256(spec), part_hashes: { authoring: jcsSha256(spec.authoring), execution: jcsSha256(spec.execution), skills: jcsSha256(spec.skills) } };
}

/** Evaluator mapping of the execution part: criterion ID -> capability and evidence source. */
export function evaluatorMap(spec: Pick<JointTemplateSpec, 'execution'>) {
  const out = new Map<string, { id: string; version: string; evidenceSource: string }>();
  for (const e of (spec.execution.evaluators as { criterion_id?: string; capability?: { id?: string; version?: string }; evidence_source?: string }[] | undefined) ?? [])
    if (e.criterion_id && e.capability?.id && e.capability.version) out.set(e.criterion_id, { id: e.capability.id, version: e.capability.version, evidenceSource: String(e.evidence_source ?? '') });
  return out;
}
