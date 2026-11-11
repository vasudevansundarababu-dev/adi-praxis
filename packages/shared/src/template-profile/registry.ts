import { itemFieldsOf, type ItemField } from './helpers';
import { FIELD_TYPES, SECTION_KEYS, TemplateProfileSchema, type ProfileCondition, type RequiredRule, type TemplateProfile } from './schema';

/**
 * The one template profile registry (handover ch. 05, ch. 16). A profile is registered once; registration checks it
 * and records a diagnostic when it is unsupported, so a broken profile never renders as a blank form.
 */

export type ProfileLookup =
  | { status: 'ok'; profile: TemplateProfile }
  | { status: 'unsupported'; workflow: string; problems: string[] }
  | { status: 'none'; workflow: string };

const registry = new Map<string, Exclude<ProfileLookup, { status: 'none' }>>();
const byId = new Map<string, TemplateProfile>();

/** Catalogue names match ignoring case, spacing and dash style (as the catalogue import does). */
export const workflowKey = (name: string) =>
  name
    .normalize('NFKC')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const KNOWN = new Set<string>(FIELD_TYPES);

/** Walks the raw input first, so an unknown type gets a plain diagnostic instead of a Zod enum message. */
function unknownTypes(raw: unknown): string[] {
  const out: string[] = [];
  const walk = (fields: unknown, path: string) => {
    if (!Array.isArray(fields)) return;
    fields.forEach((f, i) => {
      if (!isObj(f)) return;
      const p = `${path}.${typeof f.key === 'string' ? f.key : `[${i}]`}`;
      if (typeof f.type !== 'string' || !KNOWN.has(f.type)) out.push(`${p}: unsupported field type "${String(f.type)}"`);
      walk(f.itemFields, p);
    });
  };
  if (isObj(raw) && Array.isArray(raw.sections)) raw.sections.forEach((s, i) => isObj(s) && walk(s.fields, typeof s.key === 'string' ? s.key : `sections[${i}]`));
  return out;
}

/** Every reason a profile cannot be registered. Empty means supported. */
export function checkProfile(raw: unknown): string[] {
  const types = unknownTypes(raw);
  if (types.length) return types;
  const parsed = TemplateProfileSchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.') || 'profile'}: ${i.message}`);
  const p = parsed.data;
  const out: string[] = [];

  p.sections.forEach((s, i) => {
    if (s.key !== SECTION_KEYS[i]) out.push(`sections[${i}]: expected ${SECTION_KEYS[i]}, found ${s.key}`);
    if (s.checksOnly && s.key !== 'S8') out.push(`${s.key}: only S8 may be checks-only`);
    if (!s.fields.length && !(s.key === 'S8' && s.checksOnly)) out.push(`${s.key}: section has no fields`);
  });

  const top = new Map<string, ItemField>();
  for (const s of p.sections)
    for (const f of s.fields) {
      if ([...top.keys()].some((k) => k.endsWith(`.${f.key}`))) out.push(`${s.key}.${f.key}: duplicate field key`);
      top.set(`${s.key}.${f.key}`, f);
    }

  const checkConditions = (rule: RequiredRule | undefined, path: string, siblings: Map<string, ItemField> | null) => {
    if (!rule || typeof rule === 'boolean') return;
    for (const c of [...rule.anyOf, ...(rule.unless ?? [])] as ProfileCondition[]) {
      const ok = c.field.includes('.') ? top.has(c.field) : !!siblings?.has(c.field);
      if (!ok) out.push(`${path}: condition refers to unknown field "${c.field}"`);
    }
  };

  const outputFields = new Set<string>();
  const checkField = (f: ItemField, path: string, siblings: Map<string, ItemField> | null, section: string) => {
    if (f.type === 'pick_list' && !f.options?.length) out.push(`${path}: pick list has no options`);
    if (f.type === 'multi_select' && !f.options?.length && !f.allowCustom) out.push(`${path}: multi-select has no options`);
    if (f.type === 'tool_call' && !f.options?.length && !f.allowCustom) out.push(`${path}: tool call has no tool catalogue`);
    if (f.options && new Set(f.options.map((o) => o.value)).size !== f.options.length) out.push(`${path}: duplicate option values`);
    if (f.type === 'repeated_array' && !f.itemFields?.length) out.push(`${path}: repeated array has no item fields`);
    if (f.type !== 'repeated_array' && f.itemFields) out.push(`${path}: only repeated arrays declare item fields`);
    if ((f.weightTotal !== undefined || f.requireCritical) && f.type !== 'criterion') out.push(`${path}: weight rules apply to criterion fields only`);
    if (p.storage === 'canonical' && siblings === null && !f.path) out.push(`${path}: canonical profiles need a storage path for every field`);
    if (p.storage === 'sections' && f.path) out.push(`${path}: storage paths are for canonical profiles only`);
    if (f.outputField) {
      if (siblings !== null || section !== 'S6' || (f.type !== 'pick_list' && f.type !== 'number')) out.push(`${path}: only S6 pick-list or number fields map to an output field`);
      if (outputFields.has(f.outputField)) out.push(`${path}: duplicate output field "${f.outputField}"`);
      outputFields.add(f.outputField);
    }
    checkConditions(f.required, path, siblings);
    const items = itemFieldsOf(f);
    const keys = new Map<string, ItemField>();
    for (const sub of items) {
      if (keys.has(sub.key)) out.push(`${path}.${sub.key}: duplicate field key`);
      keys.set(sub.key, sub);
    }
    for (const sub of items) checkField(sub, `${path}.${sub.key}`, keys, section);
  };
  for (const s of p.sections) for (const f of s.fields) checkField(f, `${s.key}.${f.key}`, null, s.key);

  const title = top.get(`S1.${p.titleField}`);
  if (!title || title.type !== 'text') out.push(`titleField: S1.${p.titleField} must be a text field`);

  if (p.storage === 'sections' && !p.contract) out.push('contract: sections profiles need a contract mapping');
  if (p.contract) {
    const want = (ref: string | null, path: string, types: string[]) => {
      if (ref === null) return;
      const f = top.get(ref);
      if (!f) out.push(`contract.${path}: unknown field ${ref}`);
      else if (!types.includes(f.type)) out.push(`contract.${path}: ${ref} must be ${types.join(' or ')}`);
    };
    p.contract.objective.forEach((r, i) => {
      want(r, `objective[${i}]`, ['text', 'long_text']);
      if (!r.startsWith('S1.')) out.push(`contract.objective[${i}]: objective fields come from S1`);
    });
    p.contract.actorEvidence.forEach((r, i) => {
      want(r, `actorEvidence[${i}]`, [...FIELD_TYPES]);
      if ((top.get(r)?.visibility ?? 'author_and_agent') !== 'author_and_agent') out.push(`contract.actorEvidence[${i}]: ${r} is private`);
    });
    p.contract.privateEvidence.forEach((r, i) => want(r, `privateEvidence[${i}]`, ['text', 'long_text']));
    want(p.contract.policies, 'policies', ['policy_citation']);
    want(p.contract.decisionFields, 'decisionFields', ['repeated_array']);
    want(p.contract.criteria, 'criteria', ['criterion']);
    if (!outputFields.size && !p.contract.decisionFields) out.push('contract: the profile declares no output fields');
  }
  return out;
}

export type RegistrationResult = { ok: true; profile: TemplateProfile } | { ok: false; workflow: string | null; problems: string[] };

/** Registers a profile for its catalogue workflow. An unsupported profile is recorded as a diagnostic. */
export function registerProfile(raw: unknown): RegistrationResult {
  const problems = checkProfile(raw);
  const workflow = isObj(raw) && typeof raw.catalogWorkflowName === 'string' ? raw.catalogWorkflowName : null;
  if (problems.length) {
    if (workflow) registry.set(workflowKey(workflow), { status: 'unsupported', workflow, problems });
    return { ok: false, workflow, problems };
  }
  const profile = TemplateProfileSchema.parse(raw);
  registry.set(workflowKey(profile.catalogWorkflowName), { status: 'ok', profile });
  byId.set(profile.profileId, profile);
  return { ok: true, profile };
}

/** The profile for a catalogue workflow, a diagnostic when its profile is unsupported, or `none`. */
export function profileForWorkflow(name: string): ProfileLookup {
  return registry.get(workflowKey(name)) ?? { status: 'none', workflow: name };
}

/** A supported profile by its ID. */
export const profileById = (id: string): TemplateProfile | undefined => byId.get(id);

/** Every supported profile. */
export const registeredProfiles = (): TemplateProfile[] => [...byId.values()];
