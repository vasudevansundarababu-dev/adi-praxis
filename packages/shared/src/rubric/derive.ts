import type { SectionKey, TemplateProfile, TemplateProfileField } from '../template-profile/schema';
import { getFieldValue } from '../template-profile/helpers';
import type { AnnotationDetails, ApplicabilityKind, SourceKind, SourceLink, TaskSourceItem } from './schema';
import { nameFromId, type TemplateRubric } from './template-rubric';

/**
 * Deterministic rubric derivation (plan section 4, layer 1). No model, no network. It reads the selected template
 * version's own field definitions (contract pointers, field types, item fields, the workflow graph, the output schema),
 * never section numbers, and the task's ticked sources and selected policy rules. It suggests; it never decides.
 */

/** A policy rule the task uses (from the project's published rule set, limited to ticked documents). */
export interface PolicyRuleRef {
  ruleKey: string;
  ruleVersionId: string;
  title: string;
  requirement: string;
  documentVersionId: string | null;
  documentTitle: string | null;
  /** Policy rule annotations (PR #81) when present: marking, applies-when, responsible actor. */
  marking?: string | null;
  appliesWhen?: string | null;
  actor?: string | null;
  required?: boolean;
  quote?: string | null;
  locator?: Record<string, unknown> | null;
}

export interface DeriveInput {
  profile: TemplateProfile;
  output: Record<string, unknown>;
  rubric: TemplateRubric;
  template: { id: string; version: number; caseSelector?: { field: string; source: string; values: string[] } | null };
  task: { id: string; revision: number };
  policies: PolicyRuleRef[];
  sources: TaskSourceItem[];
  /** SHA-256 of a JSON-able value (injected so the module stays browser-safe). */
  hash: (v: unknown) => string;
}

export type FieldRole = 'objective' | 'inputs' | 'tools' | 'policies' | 'steps' | 'outputs' | 'safety' | 'case' | 'rubric' | 'private' | 'provenance' | 'unknown';

export interface Atom {
  target: string;
  kind: SourceKind;
  label: string;
  role: FieldRole;
  text: string;
  value: unknown;
  section?: SectionKey;
  field?: string;
  itemPath?: string;
  stepId?: string;
  roleId?: string;
  rule?: PolicyRuleRef;
  /** A mandatory requirement this source states (coverage). */
  mandatory: boolean;
}

export interface Requirement {
  key: string;
  label: string;
  kind: SourceKind;
  mandatory: boolean;
  applicability: ApplicabilityKind;
}

export interface DerivedCriterion {
  id: string;
  links: SourceLink[];
  /** Kinds of source a reliable link could not be found for ("Source link needed"). */
  needs: string[];
  details: AnnotationDetails;
}

export interface Addition {
  id: string;
  name: string;
  requirement: string;
  links: SourceLink[];
  details: AnnotationDetails;
}

export interface Derivation {
  roles: { section: SectionKey; field: string; label: string; role: FieldRole; reason: string }[];
  /** Fields not used, each with the reason (nothing is skipped silently). */
  unused: { section: SectionKey; field: string; label: string; reason: string }[];
  requirements: Requirement[];
  criteria: DerivedCriterion[];
  additions: Addition[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(', ') : v == null ? '' : JSON.stringify(v));
const clip = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const short = (s: string, n = 48) => clip(s.replace(/\s+/g, ' ').trim(), n);

const STOP = new Set('the a an and or of to for in on at by with from is are be been it its this that these those each every any all no not as into per than then when where which who whom whose if else so do does did done can could should would may might must will shall has have had was were their there them they we you your our out up about over under after before only also other another such same own more most less least very just both either neither nor one two three task agent case application applications record recorded result results use used using step steps'.split(' '));

/** Lower-case word stems with light, rule-based suffix stripping (no domain dictionary). */
export function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOP.has(raw)) continue;
    let w = raw;
    for (const suf of ['ification', 'ications', 'ication', 'ations', 'ation', 'ities', 'ity', 'ings', 'ing', 'ied', 'ies', 'ed', 'es', 's', 'y', 'e']) {
      if (w.length - suf.length >= 4 && w.endsWith(suf)) {
        w = w.slice(0, -suf.length);
        break;
      }
    }
    out.add(w.slice(0, 7));
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>) {
  let n = 0;
  for (const w of a) if (b.has(w)) n += w.length >= 6 ? 2 : 1;
  return n;
}

/** The role of one field in the selected template version, with the reason (shown to the author). */
export function fieldRole(profile: TemplateProfile, section: SectionKey, f: TemplateProfileField, toolIds: Set<string>, caseSource: string | null): { role: FieldRole; reason: string } {
  const ref = `${section}.${f.key}`;
  const c = profile.contract;
  if (f.type === 'criterion') return { role: 'rubric', reason: 'the rubric itself' };
  if (caseSource === ref) return { role: 'case', reason: 'the template’s case selector' };
  if (c?.objective.includes(ref)) return { role: 'objective', reason: 'the template’s objective' };
  if (c?.policies === ref || f.type === 'policy_citation') return { role: 'policies', reason: 'policy citations' };
  if (f.type === 'tool_call') return { role: 'tools', reason: 'recorded tool calls' };
  if (f.type === 'multi_select' && f.options?.length && toolIds.size && f.options.every((o) => toolIds.has(o.value))) return { role: 'tools', reason: 'its options are the template’s tools' };
  const keys = new Set((f.itemFields ?? []).map((x) => x.key.toLowerCase()));
  if (f.type === 'repeated_array' && [...keys].some((k) => /sha256|contentsha/.test(k))) return { role: 'policies', reason: 'items carry policy identities' };
  if (f.visibility === 'private_reference' || f.visibility === 'private_rubric') return { role: 'private', reason: 'private reviewer notes' };
  if (c?.actorEvidence.includes(ref)) return { role: 'inputs', reason: 'actor evidence in the template contract' };
  const words = `${f.key} ${f.label}`.toLowerCase();
  if (f.type === 'repeated_array' && (keys.has('action') || /procedure|steps|workflow/.test(words))) return { role: 'steps', reason: `read as workflow steps (from “${f.label}”)` };
  if (/output|deliverable/.test(words)) return { role: 'outputs', reason: `read as required output (from “${f.label}”)` };
  if (/safe|failure|prohibit/.test(words)) return { role: 'safety', reason: `read as safety handling (from “${f.label}”)` };
  if (/source/.test(words)) return { role: 'provenance', reason: 'provenance of the task' };
  if (/scope|context|trigger|purpose/.test(words)) return { role: 'objective', reason: `read as scope (from “${f.label}”)` };
  if (/input|evidence|document/.test(words)) return { role: 'inputs', reason: `read as inputs (from “${f.label}”)` };
  return { role: 'unknown', reason: 'no rubric role could be read from its definition' };
}

/** Every linkable source in the task: section fields, items, tools, workflow nodes, rules and required outputs. */
export function collectAtoms(input: DeriveInput): { atoms: Atom[]; roles: Derivation['roles']; unused: Derivation['unused'] } {
  const { profile, output, template, task } = input;
  const toolIds = new Set<string>();
  for (const s of profile.sections) for (const f of s.fields) if (f.type === 'multi_select' && /tool/i.test(`${f.key} ${f.label}`)) f.options?.forEach((o) => toolIds.add(o.value));
  const atoms: Atom[] = [];
  const roles: Derivation['roles'] = [];
  const unused: Derivation['unused'] = [];
  for (const s of profile.sections)
    for (const f of s.fields) {
      const { role, reason } = fieldRole(profile, s.key, f, toolIds, template.caseSelector?.source ?? null);
      roles.push({ section: s.key, field: f.key, label: f.label, role, reason });
      const value = getFieldValue(profile, output, s.key, f);
      if (role === 'rubric') continue;
      if (role === 'private' || role === 'provenance' || role === 'unknown') {
        unused.push({ section: s.key, field: f.key, label: f.label, reason });
        continue;
      }
      const base = { section: s.key, field: f.key };
      if (Array.isArray(value) && (f.type === 'repeated_array' || f.type === 'policy_citation' || f.type === 'tool_call' || f.type === 'evidence_record')) {
        value.forEach((item, i) => {
          if (!isObj(item)) return;
          const text = Object.values(item).map(str).join(' ').trim();
          if (!text) return;
          const itemPath = `${s.key}.${f.key}[${i}]`;
          if (role === 'steps') {
            const action = str(item.action ?? item.label ?? item.title ?? text);
            atoms.push({ ...base, target: `task:${itemPath}`, kind: 'WORKFLOW_STEP', label: `Workflow · ${short(action, 40)}`, role, text, value: item, itemPath, stepId: `${s.key}-${i + 1}`, mandatory: true });
          } else {
            const id = str(item.ruleId ?? item.id ?? item.policyId ?? '') || `${i + 1}`;
            atoms.push({ ...base, target: `task:${itemPath}`, kind: 'TASK_FIELD', label: `${s.key} · ${f.label} · ${short(id, 24)}`, role, text, value: item, itemPath, mandatory: false });
          }
        });
      } else if (role === 'tools' && Array.isArray(value)) {
        for (const t of value.filter((x): x is string => typeof x === 'string'))
          atoms.push({ ...base, target: `task:${s.key}.${f.key}:${t}`, kind: 'TASK_FIELD', label: `${s.key} · ${f.label} · ${t}`, role, text: t.replace(/[._]/g, ' '), value: t, itemPath: `${s.key}.${f.key}`, mandatory: false });
      } else {
        const text = str(value).trim();
        if (!text) continue;
        atoms.push({ ...base, target: `task:${s.key}.${f.key}`, kind: role === 'outputs' ? 'OUTPUT_FIELD' : 'TASK_FIELD', label: `${s.key} · ${f.label}`, role, text: `${f.label} ${text}`, value, mandatory: role === 'outputs' });
      }
    }
  // Multi-agent tasks: workflow nodes and roles from the task's own graph.
  const g = isObj(output.workflowGraph) ? output.workflowGraph : null;
  if (g) {
    for (const r of (Array.isArray(g.roles) ? g.roles : []).filter(isObj))
      atoms.push({ target: `graph:role:${str(r.id)}`, kind: 'WORKFLOW_ROLE', label: `Role · ${short(str(r.name ?? r.id), 40)}`, role: 'steps', text: `${str(r.name)} ${str(r.responsibility)}`, value: r, roleId: str(r.id), mandatory: false });
    for (const n of (Array.isArray(g.nodes) ? g.nodes : []).filter(isObj)) {
      if (n.type !== 'agent_step' && n.type !== 'human_step') continue;
      atoms.push({ target: `graph:node:${str(n.id)}`, kind: 'WORKFLOW_STEP', label: `Workflow · ${short(str(n.label ?? n.id), 40)}`, role: 'steps', text: `${str(n.label)} ${str(n.instruction ?? n.prompt)}`, value: n, stepId: str(n.id), roleId: str(n.roleId ?? n.actorRole), mandatory: n.type === 'agent_step' });
    }
  }
  for (const r of input.policies) {
    const mandatory = r.marking ? /^mandatory$/i.test(r.marking.trim()) : r.required !== false;
    atoms.push({ target: `rule:${r.ruleVersionId}`, kind: 'POLICY_RULE', label: `S4 · Policy rules · ${r.ruleKey}`, role: 'policies', text: `${r.title} ${r.requirement} ${r.appliesWhen ?? ''}`, value: { title: r.title, requirement: r.requirement }, rule: r, mandatory });
  }
  for (const p of input.rubric.outputSchema.properties)
    atoms.push({ target: `output:${p}`, kind: 'OUTPUT_FIELD', label: `Output · ${p}`, role: 'outputs', text: `${p.replace(/_/g, ' ')} ${(input.rubric.outputSchema.enums[p] ?? []).join(' ').replace(/_/g, ' ')}`, value: { property: p, enum: input.rubric.outputSchema.enums[p] ?? null }, mandatory: false });
  void task;
  return { atoms, roles, unused };
}

export function linkOf(input: DeriveInput, a: Atom): SourceLink {
  const r = a.rule;
  return {
    target: a.target,
    kind: a.kind,
    label: a.label,
    templateId: input.template.id,
    templateVersion: input.template.version,
    taskId: input.task.id,
    taskRevision: input.task.revision,
    ...(a.section ? { section: a.section } : {}),
    ...(a.field ? { field: a.field } : {}),
    ...(a.itemPath ? { itemPath: a.itemPath } : {}),
    ...(a.stepId ? { stepId: a.stepId } : {}),
    ...(a.roleId ? { roleId: a.roleId } : {}),
    ...(r ? { ruleKey: r.ruleKey, ruleVersionId: r.ruleVersionId, ...(r.documentVersionId ? { documentVersionId: r.documentVersionId } : {}), ...(r.locator ? { locator: r.locator } : {}) } : {}),
    excerpt: clip((r?.quote ?? str(a.kind === 'POLICY_RULE' ? r?.requirement : a.text)).replace(/\s+/g, ' ').trim()),
    snapshot: input.hash(a.value),
  };
}

/** The current value behind a link target (for "Source changed — check rubric"); undefined when it no longer exists. */
export function currentValue(input: DeriveInput, target: string): unknown {
  return collectAtoms(input).atoms.find((a) => a.target === target)?.value;
}

function criterionText(input: DeriveInput, id: string, item: Record<string, unknown> | undefined) {
  const d = input.rubric.criteria.find((c) => c.id === id)?.defaults;
  return [id.replace(/[_.-]/g, ' '), str(item?.name), d?.name ?? '', ...input.rubric.scoreKeys.map((k) => str(item?.[k.key] ?? d?.[k.key] ?? ''))].join(' ');
}

const MAX_LINKS = 5;

/** Rank sources for one criterion by shared word stems; at most two per role, five in all. */
function pick(atoms: Atom[], text: string): Atom[] {
  const cs = stems(text);
  const scored = atoms.map((a) => ({ a, s: overlap(cs, stems(a.text)) })).filter((x) => x.s >= 2).sort((x, y) => y.s - x.s);
  const per = new Map<FieldRole, number>();
  const out: Atom[] = [];
  for (const { a } of scored) {
    const n = per.get(a.role) ?? 0;
    if (n >= 2 || out.length >= MAX_LINKS) continue;
    per.set(a.role, n + 1);
    out.push(a);
  }
  return out;
}

function applicabilityFrom(input: DeriveInput, picked: Atom[]): { kind: ApplicabilityKind; condition: string } {
  const rules = picked.filter((a) => a.rule).map((a) => a.rule!);
  const human = picked.find((a) => a.kind === 'WORKFLOW_STEP' && isObj(a.value) && a.value.type === 'human_step') ?? rules.find((r) => r.actor && /human|officer|person|staff/i.test(r.actor));
  if (human) return { kind: 'OTHER_ROLE', condition: 'A human officer holds this responsibility. The agent routes or escalates it correctly and never exercises that authority itself.' };
  const when = rules.find((r) => r.marking && /when applicable/i.test(r.marking));
  if (when) return { kind: 'REQUIRED_WHEN', condition: when.appliesWhen?.trim() || `When rule ${when.ruleKey} applies to the application.` };
  const option = rules.find((r) => r.marking && /permitted/i.test(r.marking));
  if (option) return { kind: 'PERMITTED_OPTION', condition: option.appliesWhen?.trim() || `When the route permitted by ${option.ruleKey} is chosen. Its companion conditions apply only then.` };
  const sel = input.template.caseSelector;
  if (picked.some((a) => a.kind === 'WORKFLOW_STEP')) return { kind: 'REQUIRED', condition: sel ? `Every application this task covers, by its actual ${sel.field.replace(/_/g, ' ')} (never the example value).` : 'Every application this task covers.' };
  return { kind: 'UNSET', condition: '' };
}

export function derive(input: DeriveInput): Derivation {
  const { rubric } = input;
  const { atoms: all, roles, unused } = collectAtoms(input);
  // Only ticked policy documents count as sources; a rule from an unticked document is not linked.
  const ticked = new Set(input.sources.filter((s) => s.ticked && s.kind === 'POLICY_DOCUMENT').map((s) => s.ref));
  const atoms = all.filter((a) => !a.rule || !a.rule.documentVersionId || ticked.has(a.rule.documentVersionId));
  const value = isObj(input.output.sections) ? (input.output.sections as Record<string, Record<string, unknown>>)[rubric.section]?.[rubric.fieldKey] : undefined;
  const items = (Array.isArray(value) ? value.filter(isObj) : []) as Record<string, unknown>[];
  const ids = [...new Set([...rubric.criteria.map((c) => c.id), ...items.map((i) => str(i.id)).filter(Boolean)])];
  const agentLabel = input.profile.agentMode === 'SINGLE' ? 'The agent' : null;
  const criteria: DerivedCriterion[] = ids.map((id) => {
    const item = items.find((i) => i.id === id);
    const d = rubric.criteria.find((c) => c.id === id)?.defaults ?? null;
    const text = criterionText(input, id, item);
    const picked = pick(atoms, text);
    const needs: string[] = [];
    const mentionsPolicy = /\bpolic(y|ies)\b|\brules?\b/i.test(text);
    if (mentionsPolicy && !picked.some((a) => a.kind === 'POLICY_RULE')) needs.push('Policy rule');
    if (!picked.length) needs.push('Source');
    const step = picked.find((a) => a.kind === 'WORKFLOW_STEP');
    const role = picked.find((a) => a.kind === 'WORKFLOW_ROLE');
    const tools = picked.filter((a) => a.role === 'tools').map((a) => str(a.value));
    const app = applicabilityFrom(input, picked);
    const unresolved: string[] = [];
    if (needs.includes('Policy rule')) unresolved.push('No policy rule among the ticked sources covers this criterion. Tick or add a source; nothing is invented.');
    if (app.kind === 'UNSET') unresolved.push('When this applies could not be read from the task. Set it with Change.');
    const name = str(item?.name) || d?.name || nameFromId(id);
    return {
      id,
      links: picked.map((a) => linkOf(input, a)),
      needs,
      details: {
        assesses: d?.passCondition ?? '',
        applicability: { kind: app.kind, condition: app.condition, exceptions: '' },
        wholeTaskFailure: d?.critical ? { condition: d.criticalCondition ?? '', kind: 'FAIL_OF_CRITERION' } : null,
        evidenceRequired: tools.length ? `Results of ${tools.join(', ')} in the run, cited in the findings; a recorded gap for any check that is pending or refused.` : '',
        stepLabel: step ? step.label.replace(/^Workflow · /, '') : null,
        roleLabel: role ? role.label.replace(/^Role · /, '') : agentLabel,
        skill: name,
        why: picked.length ? `Linked to ${picked.slice(0, 3).map((a) => a.label).join(', ')}${picked.length > 3 ? ' and more' : ''}.` : 'No reliable source was found in the task.',
        unresolved,
        covers: picked.filter((a) => a.mandatory).map((a) => a.target),
      },
    };
  });
  const requirements: Requirement[] = atoms.filter((a) => a.mandatory).map((a) => ({ key: a.target, label: a.label, kind: a.kind, mandatory: true, applicability: a.rule ? applicabilityFrom(input, [a]).kind : 'REQUIRED' }));
  // Uncovered mandatory requirements become suggested additions (internal only on a fixed evaluator map).
  const covered = new Set(criteria.flatMap((c) => c.details.covers));
  const additions: Addition[] = atoms
    .filter((a) => a.mandatory && a.kind !== 'OUTPUT_FIELD' && !covered.has(a.target))
    .slice(0, 5)
    .map((a) => {
      const label = a.label.replace(/^(Workflow|S4 · Policy rules) · /, '');
      return {
        id: `x-${input.hash(a.target).slice(0, 10)}`,
        name: short(a.rule ? a.rule.title : label, 60),
        requirement: a.target,
        links: [linkOf(input, a)],
        details: {
          assesses: clip(a.rule ? a.rule.requirement : str(isObj(a.value) ? (a.value.action ?? a.text) : a.text), 600),
          applicability: { kind: 'UNSET', condition: '', exceptions: '' },
          wholeTaskFailure: null,
          evidenceRequired: '',
          stepLabel: a.kind === 'WORKFLOW_STEP' ? label : null,
          roleLabel: agentLabel,
          skill: short(label, 60),
          why: `No template criterion covers ${a.label}.`,
          unresolved: ['RubricApplicability not set yet.'],
          covers: [a.target],
        },
      };
    });
  return { roles, unused, requirements, criteria, additions };
}

/** Requirements no active criterion covers, and requirements carried by more than one weighted criterion. */
export function coverage(requirements: Requirement[], active: { id: string; covers: string[]; weighted: boolean }[]) {
  const gaps = requirements.filter((r) => r.mandatory && !active.some((c) => c.covers.includes(r.key)));
  const duplicates = requirements
    .map((r) => ({ r, by: active.filter((c) => c.weighted && c.covers[0] === r.key).map((c) => c.id) }))
    .filter((x) => x.by.length > 1)
    .map((x) => ({ requirement: x.r.label, criteria: x.by }));
  return { total: requirements.filter((r) => r.mandatory).length, covered: requirements.filter((r) => r.mandatory).length - gaps.length, gaps, duplicates };
}
