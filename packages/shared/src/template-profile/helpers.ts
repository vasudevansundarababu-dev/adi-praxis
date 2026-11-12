import { PROFILE_SECTIONS, type FieldVisibility, type PickOption, type ProfileCondition, type TemplateProfileField, type ProfileOutput, type RequiredRule, type SectionKey, type TemplateProfile } from './schema';

/**
 * Pure helpers over a TemplateProfile and a task output. None of them mutates its input. Outputs that the profile
 * does not apply to (legacy generic outputs with no `profile` key) are left alone: no problems, no projection.
 */

/** A field as the helpers see it: the shared primitives plus `flag`, used only inside built-in records. */
export type ItemField = Omit<TemplateProfileField, 'type' | 'itemFields'> & { type: TemplateProfileField['type'] | 'flag'; itemFields?: ItemField[] };

const opt = (value: string, label = value) => ({ value, label });

export const COMPARISONS = ['json_equals', 'json_number_min', 'json_number_max'] as const;

/** An executable check on one output.json field (praxis.anvil.task.v1 DecisionBinding). Optional for drafts. */
const BINDING_FIELDS = (help: string): ItemField[] => [
  { key: 'outputField', type: 'text', label: 'Output field', help, visibility: 'private_reference' },
  {
    key: 'comparison',
    type: 'pick_list',
    label: 'Comparison',
    help: 'Equals, at least (number) or at most (number).',
    options: [
      { value: 'json_equals', label: 'Equals' },
      { value: 'json_number_min', label: 'At least (number)' },
      { value: 'json_number_max', label: 'At most (number)' },
    ],
    required: { anyOf: [{ field: 'outputField', filled: true }] },
    visibility: 'private_reference',
  },
  { key: 'expectedValue', type: 'text', label: 'Expected value', help: 'The value the output field must have (or the bound for a number).', required: { anyOf: [{ field: 'outputField', filled: true }] }, visibility: 'private_reference' },
];

/** Built-in item fields of the structured primitives. A repeated_array declares its own. */
export function itemFieldsOf(field: ItemField): ItemField[] {
  switch (field.type) {
    case 'repeated_array':
      return field.itemFields ?? [];
    case 'evidence_record':
      return [
        { key: 'id', type: 'text', label: 'Evidence ID', help: 'Stable ID that findings and steps cite.', required: true },
        field.options?.length
          ? { key: 'type', type: 'pick_list', label: 'Evidence type', help: 'What kind of record this is.', required: true, options: field.options, allowCustom: field.allowCustom }
          : { key: 'type', type: 'text', label: 'Evidence type', help: 'What kind of record this is.', required: true },
        { key: 'source', type: 'text', label: 'Source / issuer', help: 'Where the record comes from. Leave unknown provenance as unknown; do not invent it.' },
        { key: 'date', type: 'date', label: 'Relevant date', help: 'The date of the record known to the case (YYYY-MM-DD).' },
        { key: 'content', type: 'long_text', label: 'Content', help: 'The relevant text or values, as the agent will see them. Authorised test data only.', required: true },
      ];
    case 'policy_citation':
      return [
        { key: 'ruleId', type: 'text', label: 'Rule ID', help: 'The approved project rule.', required: true },
        { key: 'ruleVersion', type: 'text', label: 'Rule version', help: 'The exact published version.', required: true },
        { key: 'locator', type: 'text', label: 'Source page / clause', help: 'Where the authority is in the source.', required: true },
        { key: 'quote', type: 'long_text', label: 'Quotation', help: 'A faithful quotation of the rule text.' },
        { key: 'appliesTo', type: 'text', label: 'Applies to step / role', help: 'The work this rule governs.', visibility: 'private_reference' },
        { key: 'rationale', type: 'long_text', label: 'Applicability rationale', help: 'Why the rule applies to this case: scope, category, exceptions.', required: true, visibility: 'private_reference' },
        { key: 'exception', type: 'long_text', label: 'Conflict or exception', help: 'Competing rules or unmet conditions. Do not silently pick precedence.', visibility: 'private_reference' },
        ...BINDING_FIELDS('The output.json field this rule constrains, when it can be checked on the output. Leave empty for a rule given to the agent as context only.'),
        { key: 'hardFailure', type: 'flag', label: 'Hard failure', help: 'Breaking this rule fails the task outright.', visibility: 'private_reference' },
      ];
    case 'tool_call':
      return [
        { key: 'id', type: 'text', label: 'Response ID', help: 'Stable ID of this recorded call.', required: true },
        field.options?.length
          ? { key: 'tool', type: 'pick_list', label: 'Tool', help: 'An allowed tool from the template catalogue.', required: true, options: field.options, allowCustom: field.allowCustom }
          : { key: 'tool', type: 'text', label: 'Tool', help: 'The tool this call uses.', required: true },
        { key: 'arguments', type: 'long_text', label: 'Arguments', help: 'The inputs the call receives, referencing the right party or evidence ID.', required: true },
        { key: 'response', type: 'long_text', label: 'Recorded response', help: 'What the environment returns. This is not evidence that a live tool ran.', required: true },
        { key: 'evidenceRef', type: 'text', label: 'Linked evidence ID', help: 'The evidence item this response relates to, if any.' },
      ];
    case 'criterion':
      return [
        { key: 'id', type: 'text', label: 'Criterion ID', help: 'Stable ID that common errors refer to.', required: true },
        { key: 'name', type: 'text', label: 'What is assessed', help: 'A short name for the criterion.', required: true },
        { key: 'weight', type: 'number', label: 'Weight', help: 'Contribution to the total score.', required: true, min: 0, max: 100 },
        { key: 'passCondition', type: 'long_text', label: 'Pass condition', help: 'Observable against the case evidence, tool calls or output.', required: true },
        { key: 'partialCredit', type: 'long_text', label: 'Partial credit', help: 'What incomplete but useful work earns (scores 2 of 5).' },
        // Owner, 11 Nov 2026 (Anvil Q4): required on templates Anvil proposed, so each criterion states 5, 2 and 0.
        { key: 'failCondition', type: 'long_text', label: 'Fail', help: 'What scores 0. Required when the template was proposed by Anvil.' },
        { key: 'critical', type: 'flag', label: 'Critical', help: 'Failing this criterion is a critical failure (separate from a zero-weight criterion).' },
        { key: 'evidenceRefs', type: 'multi_select', label: 'Evidence or rule links', help: 'Evidence, rule or step IDs this criterion checks.', allowCustom: true },
        // Praxis-Anvil contract (12 Nov 2026): on a template Anvil proposed, the kind must be one the template allows.
        { key: 'evaluatorKind', type: 'text', label: 'Evaluator kind', help: 'How Anvil grades this criterion (one of the kinds the template allows, e.g. run_evidence). Leave empty if the template has no Anvil spec.' },
        // Anvil's four confirmations (11 Nov 2026), point 3: the evaluator is an exact (id, version) pair from Anvil's catalogue.
        { key: 'evaluatorVersion', type: 'text', label: 'Evaluator version', help: 'The version of that evaluator in the template’s execution part (e.g. 1). Leave empty if the template has no Anvil spec.' },
        ...BINDING_FIELDS('The output.json field this criterion checks. Needed for executable export.'),
      ];
    default:
      return [];
  }
}

export const isArrayType = (t: ItemField['type']) => t === 'repeated_array' || t === 'evidence_record' || t === 'policy_citation' || t === 'tool_call' || t === 'criterion';

export function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return Number.isNaN(v);
  return false;
}

export const sectionTitle = (key: string) => PROFILE_SECTIONS.find((s) => s.key === key)?.title ?? key;

// ───────────────────────── storage ─────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function getPath(o: unknown, path: string): unknown {
  let cur: unknown = o;
  for (const p of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(o: Record<string, unknown>, path: string, v: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split('.');
  if (!rest.length) return { ...o, [head!]: v };
  const child = isObj(o[head!]) ? (o[head!] as Record<string, unknown>) : {};
  return { ...o, [head!]: setPath(child, rest.join('.'), v) };
}

/** Does this profile apply to this output? Section profiles need `output.profile.id`; canonical ones apply to any object. */
export function profileApplies(profile: TemplateProfile, output: unknown): boolean {
  if (!isObj(output)) return false;
  if (profile.storage === 'canonical') return true;
  return isObj(output.profile) && output.profile.id === profile.profileId;
}

/** The stored value of a section field. */
export function getFieldValue(profile: TemplateProfile, output: unknown, section: SectionKey, field: Pick<TemplateProfileField, 'key' | 'path'>): unknown {
  if (profile.storage === 'canonical') return getPath(output, field.path ?? field.key);
  const s = isObj(output) && isObj(output.sections) ? output.sections[section] : undefined;
  return isObj(s) ? s[field.key] : undefined;
}

/** Returns a new output with one section field set. The title field is mirrored into `header.title`. */
export function setFieldValue<T extends Record<string, unknown>>(profile: TemplateProfile, output: T, section: SectionKey, fieldKey: string, value: unknown): T {
  const field = profile.sections.find((s) => s.key === section)?.fields.find((f) => f.key === fieldKey);
  if (!field) throw new Error(`Unknown field ${section}.${fieldKey} in profile ${profile.profileId}`);
  if (profile.storage === 'canonical') return setPath(output, field.path ?? field.key, value) as T;
  const sections = isObj(output.sections) ? output.sections : {};
  const current = isObj(sections[section]) ? (sections[section] as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...output, sections: { ...sections, [section]: { ...current, [fieldKey]: value } } };
  if (section === 'S1' && fieldKey === profile.titleField) next.header = { ...(isObj(output.header) ? output.header : {}), title: typeof value === 'string' ? value : '' };
  return next as T;
}

function emptyValue(f: ItemField): unknown {
  if (isArrayType(f.type) || f.type === 'multi_select') return [];
  if (f.type === 'number') return null;
  if (f.type === 'flag') return false;
  return '';
}

/** An empty item for an array field, with a suggested unique ID when the item has an `id` field. */
export function newItem(field: ItemField, existing: unknown[] = []): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const f of itemFieldsOf(field)) item[f.key] = emptyValue(f);
  if ('id' in item) {
    const prefix = field.idPrefix ?? (field.type === 'evidence_record' ? 'E' : field.type === 'tool_call' ? 'R' : field.type === 'criterion' ? 'C' : field.type === 'policy_citation' ? 'PR' : '');
    if (prefix) {
      const taken = new Set(existing.map((x) => (isObj(x) ? x.id : undefined)));
      let n = existing.length + 1;
      while (taken.has(`${prefix}${n}`)) n++;
      item.id = `${prefix}${n}`;
    }
  }
  return item;
}

/** A blank profile-driven output: every section present with empty values, header kept in sync. */
export function emptyOutput(profile: TemplateProfile): Record<string, unknown> {
  if (profile.storage === 'canonical') return {};
  const sections: Record<string, Record<string, unknown>> = {};
  for (const s of profile.sections) sections[s.key] = Object.fromEntries(s.fields.map((f) => [f.key, emptyValue(f)]));
  return { profile: { id: profile.profileId, version: profile.version }, header: { title: '' }, sections } satisfies ProfileOutput;
}

/** Adds an empty item to an array field (`S2.evidence`). */
export function addRepeatedItem<T extends Record<string, unknown>>(profile: TemplateProfile, output: T, section: SectionKey, fieldKey: string): T {
  const field = profile.sections.find((s) => s.key === section)?.fields.find((f) => f.key === fieldKey);
  if (!field || !isArrayType(field.type)) throw new Error(`${section}.${fieldKey} is not an array field`);
  const cur = getFieldValue(profile, output, section, field);
  const list = Array.isArray(cur) ? cur : [];
  return setFieldValue(profile, output, section, fieldKey, [...list, newItem(field, list)]);
}

/** Removes the item at `index` from an array field. */
export function removeRepeatedItem<T extends Record<string, unknown>>(profile: TemplateProfile, output: T, section: SectionKey, fieldKey: string, index: number): T {
  const field = profile.sections.find((s) => s.key === section)?.fields.find((f) => f.key === fieldKey);
  if (!field || !isArrayType(field.type)) throw new Error(`${section}.${fieldKey} is not an array field`);
  const cur = getFieldValue(profile, output, section, field);
  const list = Array.isArray(cur) ? cur : [];
  return setFieldValue(profile, output, section, fieldKey, list.filter((_, i) => i !== index));
}

// ───────────────────────── requiredness and problems ─────────────────────────

export interface ProfileProblem {
  section: SectionKey;
  /** `S2.evidence[0].content` */
  path: string;
  /** Top-level field key in the section. */
  field: string;
  kind: 'required' | 'conditional' | 'min_items' | 'invalid';
  message: string;
}

type Lookup = (ref: string) => unknown;

function holds(c: ProfileCondition, lookup: Lookup): boolean {
  const v = lookup(c.field);
  if (c.filled !== undefined) return c.filled === !isEmpty(v);
  const s = typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
  if (c.equals !== undefined) return s === c.equals;
  return s !== undefined && (c.in ?? []).includes(s);
}

/** Whether a rule makes the field required now; `conditional` tells a conditional rule from a plain one. */
export function evaluateRequired(rule: RequiredRule | undefined, lookup: Lookup): { required: boolean; conditional: boolean } {
  if (rule === undefined || rule === false) return { required: false, conditional: false };
  if (rule === true) return { required: true, conditional: false };
  const on = rule.anyOf.some((c) => holds(c, lookup)) && !(rule.unless ?? []).some((c) => holds(c, lookup));
  return { required: on, conditional: true };
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const optionValues = (o?: PickOption[]) => new Set((o ?? []).map((x) => x.value));

/** The top-level lookup for conditions: `S6.disposition`. */
function topLookup(profile: TemplateProfile, output: unknown): Lookup {
  return (ref) => {
    const [sk, key] = ref.split('.');
    const section = profile.sections.find((s) => s.key === sk);
    const field = section?.fields.find((f) => f.key === key);
    return section && field ? getFieldValue(profile, output, section.key, field) : undefined;
  };
}

function fieldProblems(f: ItemField, value: unknown, path: string, label: string, lookup: Lookup, section: SectionKey, top: string, out: ProfileProblem[]) {
  const req = evaluateRequired(f.required, lookup);
  const push = (kind: ProfileProblem['kind'], message: string) => out.push({ section, path, field: top, kind, message: `${label}: ${message}` });
  if (isEmpty(value)) {
    if (req.required) push(req.conditional ? 'conditional' : 'required', req.conditional ? 'required in this case' : 'required');
    return;
  }
  switch (f.type) {
    case 'text':
    case 'long_text':
    case 'graph_binding':
      if (typeof value !== 'string') push('invalid', 'must be text');
      break;
    case 'date':
      if (typeof value !== 'string' || !isDate(value)) push('invalid', 'must be a date (YYYY-MM-DD)');
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) push('invalid', 'must be a number');
      else if ((f.min !== undefined && value < f.min) || (f.max !== undefined && value > f.max)) push('invalid', `must be between ${f.min ?? '−∞'} and ${f.max ?? '∞'}`);
      break;
    case 'pick_list':
      if (typeof value !== 'string') push('invalid', 'must be one of the listed values');
      else if (!f.allowCustom && !optionValues(f.options).has(value)) push('invalid', `"${value}" is not an allowed value`);
      break;
    case 'multi_select':
      if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) push('invalid', 'must be a list of values');
      else if (!f.allowCustom) {
        const bad = value.filter((x) => !optionValues(f.options).has(x as string));
        if (bad.length) push('invalid', `not allowed: ${bad.join(', ')}`);
      }
      break;
    case 'flag':
      if (typeof value !== 'boolean') push('invalid', 'must be yes or no');
      break;
    default: {
      if (!Array.isArray(value)) {
        push('invalid', 'must be a list');
        break;
      }
      const min = f.minItems ?? 1;
      if (req.required && value.length < min) push('min_items', `add at least ${min}`);
      if (f.maxItems !== undefined && value.length > f.maxItems) push('invalid', `at most ${f.maxItems} allowed (now ${value.length})`);
      const items = itemFieldsOf(f);
      const noun = f.itemLabel ?? 'item';
      value.forEach((item, i) => {
        const itemPath = `${path}[${i}]`;
        if (!isObj(item)) {
          out.push({ section, path: itemPath, field: top, kind: 'invalid', message: `${label} ${i + 1}: must be a record` });
          return;
        }
        const sibling: Lookup = (ref) => (ref.includes('.') ? lookup(ref) : item[ref]);
        for (const sub of items) fieldProblems(sub, item[sub.key], `${itemPath}.${sub.key}`, `${cap(noun)} ${i + 1} › ${sub.label}`, sibling, section, top, out);
      });
      if (f.type === 'criterion') {
        const total = value.reduce<number>((n, x) => n + (isObj(x) && typeof x.weight === 'number' ? x.weight : 0), 0);
        if (f.weightTotal !== undefined && value.length && Math.abs(total - f.weightTotal) > 0.01) push('invalid', `weights must total ${f.weightTotal} (now ${total})`);
        if (f.requireCritical && value.length && !value.some((x) => isObj(x) && x.critical === true)) push('invalid', 'mark at least one criterion as critical');
      }
    }
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Required, conditional and value checks, each with its section and field path. Legacy outputs return []. */
export function profileProblems(profile: TemplateProfile, output: unknown): ProfileProblem[] {
  if (!profileApplies(profile, output)) return [];
  const lookup = topLookup(profile, output);
  const out: ProfileProblem[] = [];
  for (const s of profile.sections) for (const f of s.fields) fieldProblems(f, getFieldValue(profile, output, s.key, f), `${s.key}.${f.key}`, f.label, lookup, s.key, f.key, out);
  return out;
}

export interface SectionProgress {
  section: SectionKey;
  title: string;
  /** Required fields (as of now, conditions included). */
  required: number;
  /** Required fields that are filled and have no problems. */
  done: number;
  /** Every problem in the section, required or not. */
  problems: number;
}

/** Required fields done per section. Legacy outputs report nothing done. */
export function sectionProgress(profile: TemplateProfile, output: unknown): SectionProgress[] {
  const applies = profileApplies(profile, output);
  const problems = applies ? profileProblems(profile, output) : [];
  const lookup = topLookup(profile, output);
  return profile.sections.map((s) => {
    const req = s.fields.filter((f) => evaluateRequired(f.required, applies ? lookup : () => undefined).required);
    const done = applies ? req.filter((f) => !isEmpty(getFieldValue(profile, output, s.key, f)) && !problems.some((p) => p.section === s.key && p.field === f.key)).length : 0;
    return { section: s.key, title: s.title, required: req.length, done, problems: problems.filter((p) => p.section === s.key).length };
  });
}

// ───────────────────────── agent projection ─────────────────────────

function effectiveVisibility(parent: FieldVisibility, own: FieldVisibility | undefined): FieldVisibility {
  if (own && own !== 'author_and_agent') return own;
  return parent;
}

function project(f: ItemField, value: unknown, parent: FieldVisibility): unknown {
  if (!isArrayType(f.type) || !Array.isArray(value)) return value;
  const items = itemFieldsOf(f);
  return value.map((item) => {
    if (!isObj(item)) return item;
    const out: Record<string, unknown> = {};
    for (const sub of items) {
      if (effectiveVisibility(parent, sub.visibility) !== 'author_and_agent' || !(sub.key in item)) continue;
      out[sub.key] = project(sub, item[sub.key], 'author_and_agent');
    }
    return out;
  });
}

/**
 * What the benchmark agent may see: only `author_and_agent` fields, at every depth (an allow-list, so undeclared or
 * legacy keys never leak). Returns null when the profile does not apply to the output.
 */
export function agentProjection(profile: TemplateProfile, output: unknown): Record<string, unknown> | null {
  if (!profileApplies(profile, output)) return null;
  if (profile.storage === 'canonical') {
    let out: Record<string, unknown> = {};
    for (const s of profile.sections)
      for (const f of s.fields) {
        if ((f.visibility ?? 'author_and_agent') !== 'author_and_agent') continue;
        const v = getFieldValue(profile, output, s.key, f);
        if (v !== undefined) out = setPath(out, f.path ?? f.key, project(f, v, 'author_and_agent'));
      }
    return out;
  }
  const sections: Record<string, Record<string, unknown>> = {};
  for (const s of profile.sections) {
    const visible: Record<string, unknown> = {};
    for (const f of s.fields) {
      if ((f.visibility ?? 'author_and_agent') !== 'author_and_agent') continue;
      const v = getFieldValue(profile, output, s.key, f);
      if (v !== undefined) visible[f.key] = project(f, v, 'author_and_agent');
    }
    if (Object.keys(visible).length) sections[s.key] = visible;
  }
  const title = getFieldValue(profile, output, 'S1', { key: profile.titleField });
  return { profile: { id: profile.profileId, version: profile.version }, title: typeof title === 'string' ? title : '', sections };
}

// ───────────────────────── stored shape (save-time) ─────────────────────────

function shapeOf(f: ItemField, v: unknown, path: string, out: string[]) {
  if (v === undefined || v === null) return;
  const t = f.type;
  if ((t === 'text' || t === 'long_text' || t === 'date' || t === 'pick_list' || t === 'graph_binding') && typeof v !== 'string') out.push(`${path} must be text`);
  else if (t === 'number' && typeof v !== 'number') out.push(`${path} must be a number`);
  else if (t === 'flag' && typeof v !== 'boolean') out.push(`${path} must be true or false`);
  else if (t === 'multi_select' && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) out.push(`${path} must be a list of text values`);
  else if (isArrayType(t)) {
    if (!Array.isArray(v)) out.push(`${path} must be a list`);
    else
      v.forEach((item, i) => {
        if (!isObj(item)) return out.push(`${path}[${i}] must be a record`);
        for (const sub of itemFieldsOf(f)) shapeOf(sub, item[sub.key], `${path}[${i}].${sub.key}`, out);
      });
  }
}

/**
 * Structural problems that block a save of a profile-driven output (drafts may be incomplete, but stored values must
 * have the right types, the profile reference must match, and the header title must mirror the title field).
 * Unknown keys are preserved, not rejected.
 */
export function profileShapeProblems(profile: TemplateProfile, output: Record<string, unknown>): string[] {
  if (profile.storage === 'canonical') return [];
  const out: string[] = [];
  const ref = output.profile;
  if (!isObj(ref) || ref.id !== profile.profileId) return [`profile must be ${profile.profileId}`];
  if (ref.version !== profile.version) out.push(`profile.version ${String(ref.version)} is not supported (expected ${profile.version})`);
  if (output.header !== undefined && !isObj(output.header)) out.push('header must be an object');
  if (!isObj(output.sections)) return [...out, 'sections must be an object'];
  for (const k of Object.keys(output.sections)) if (!profile.sections.some((s) => s.key === k)) out.push(`sections.${k} is not a section of this profile`);
  for (const s of profile.sections) {
    const sv = output.sections[s.key];
    if (sv === undefined) continue;
    if (!isObj(sv)) {
      out.push(`sections.${s.key} must be an object`);
      continue;
    }
    for (const f of s.fields) shapeOf(f, sv[f.key], `sections.${s.key}.${f.key}`, out);
  }
  const title = getFieldValue(profile, output, 'S1', { key: profile.titleField });
  const headerTitle = isObj(output.header) ? output.header.title : undefined;
  if ((typeof title === 'string' ? title : '') !== (typeof headerTitle === 'string' ? headerTitle : '')) out.push(`header.title must equal sections.S1.${profile.titleField}`);
  return out;
}

/** True for an output with no authored content yet (null, `{}`, or a blank generic header/body). */
export function isBlankOutput(output: unknown): boolean {
  if (!isObj(output)) return true;
  return Object.entries(output).every(([k, v]) => (k === 'header' ? isObj(v) : k === 'body' ? isEmpty(v) : false));
}

/** Starts a profile-driven output from a blank one, keeping any header (title, coverage tags, edge case). */
export function startProfileOutput(profile: TemplateProfile, output: unknown): Record<string, unknown> {
  const base = emptyOutput(profile);
  const header = isObj(output) && isObj(output.header) ? output.header : {};
  const title = typeof header.title === 'string' ? header.title : '';
  const withHeader = { ...base, header: { ...header, title } };
  return profile.storage === 'sections' ? setFieldValue(profile, withHeader, 'S1', profile.titleField, title) : withHeader;
}

export const opts = (...values: string[]): PickOption[] => values.map((v) => opt(v));
