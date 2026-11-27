import { jurisdictionProblem, type PolicyRuleBody } from '@praxis/shared';

/**
 * Owner, 27 Nov 2026: "highlight the fix next to the field … 12 mins is going on scrolling down and finding out which
 * section or field to edit." The rule page of a policy-library project turns every open problem (the review queue's
 * flags and the server's own definition and quote checks) into a "To fix" item that names the field to change, with a
 * plain-words hint and an example. Presentation only: the checks, flags and server rules are unchanged; this module
 * only reads what the server already sent and says where on the page each problem is fixed.
 */
export type FixField =
  | 'condition'
  | 'quotes'
  | 'kind'
  | 'issuer'
  | 'jurisdiction'
  | 'subject'
  | 'process'
  | 'change'
  | 'effective'
  | 'requirement'
  | 'type'
  | 'applies'
  | 'status';

/** The element id on the rule page for each field (the "To fix" link and "Next problem" go there). */
export const FIX_ANCHOR: Record<FixField, string> = {
  condition: 'fix-condition',
  quotes: 'fix-quotes',
  kind: 'lib-kind',
  issuer: 'lib-issuer',
  jurisdiction: 'lib-jurisdiction',
  subject: 'lib-subject',
  process: 'lib-process',
  change: 'lib-change',
  effective: 'fix-effective',
  requirement: 'fix-requirement',
  type: 'fix-type',
  applies: 'fix-applies',
  status: 'fix-status',
};

/** Fields inside "Edit the text, the in-force date and the quotes" (a closed section that loads its form when opened). */
export const EDIT_FORM_FIELDS: readonly FixField[] = ['quotes', 'effective', 'requirement', 'type', 'applies'];

/**
 * Which field(s) each queue flag code is fixed in. `library_incomplete`, `not_ready` and `open_question` split into one
 * item per missing part, per check message or per question; the fields listed here are every place they can point to.
 */
export const FLAG_FIELDS: Record<string, readonly FixField[]> = {
  condition_not_set: ['condition'],
  condition_invalid: ['condition'],
  condition_not_quoted: ['quotes'],
  library_incomplete: ['kind', 'issuer', 'jurisdiction', 'subject', 'process'],
  no_effective_date: ['effective'],
  not_ready: ['requirement', 'type', 'applies', 'effective', 'quotes', 'status'],
  change_missing: ['change'],
  definition_not_approved: ['condition'],
  coverage_: ['condition'],
  open_question: ['condition', 'quotes', 'kind', 'issuer', 'jurisdiction', 'subject', 'process', 'effective', 'status'],
  needs_review: ['status'],
  outside_scope: ['status'],
};

export interface FixItem {
  /** Stable key (flag + field + index). */
  id: string;
  flag: string;
  field: FixField;
  /** Short text for the "To fix" list. */
  label: string;
  /** What is missing and how to fix it, with an example; shown under the field. */
  hint: string;
  /** An open question shown next to its field (answered by changing the field and saving). */
  question?: string;
}

const LIBRARY_PART_FIX: Record<'kind' | 'issuer' | 'jurisdiction' | 'subject' | 'process', { label: string; hint: string }> = {
  kind: { label: 'Kind is missing', hint: 'Kind is missing. Choose regulation for a law or regulator rule, policy for the bank’s own policy, or business rule for a bank procedure.' },
  issuer: { label: 'Issuer is missing', hint: 'Issuer is missing. Choose who wrote the rule: federal (for example a FinCEN rule), state (for example California law) or bank.' },
  jurisdiction: { label: 'Jurisdiction is missing', hint: 'Jurisdiction is missing. Enter US for federal or bank rules, or US-CA for California.' },
  subject: { label: '“Evaluated for” is missing', hint: '“Evaluated for” is missing. Choose case when the rule is about the whole application (for example the product), or party when it is about one person (for example the minor).' },
  process: { label: 'Process is missing', hint: 'Process is missing. Choose the business process the rule belongs to, for example account opening.' },
};
const LIBRARY_PARTS = Object.keys(LIBRARY_PART_FIX) as (keyof typeof LIBRARY_PART_FIX)[];

/** Each server check message (definitionProblems, evidenceProblems) and the field that fixes it. */
const CHECK_FIX: { match: RegExp; field: FixField; label: string; hint: string }[] = [
  { match: /^Add the requirement/, field: 'requirement', label: 'Requirement text is missing', hint: 'The rule has no requirement text. Write what the rule requires in one sentence, for example “The minor must be 16 or younger.”' },
  { match: /^Choose whether this is an obligation/, field: 'type', label: 'Type is missing', hint: 'The type is not set. Choose Obligation when the rule says “must”, Prohibition for “must not”, Permission for “may”, or Definition when it defines a term.' },
  { match: /^Define where the rule applies/, field: 'applies', label: 'Where it applies is missing', hint: 'Where the rule applies is not set. Tick “Applies everywhere in the project”, or fill in who and what it applies to, for example actors: agent.' },
  { match: /^Set the effective scope/, field: 'effective', label: 'In-force date is missing', hint: 'There is no in-force date. Enter the date the rule is in force from, for example 2026-01-01, or set the date on its document on the Policy page.' },
  { match: /^Link the requirement to a quote/, field: 'quotes', label: 'Requirement has no source quote', hint: 'No quote from the source backs the requirement. Add a quote copied word for word from the document and choose “The requirement” for it.' },
  { match: /^Link the applicability condition/, field: 'quotes', label: '“Where it applies” has no source quote', hint: 'No quote backs where the rule applies. Add the sentence from the source that says so and choose “When it applies” for it.' },
  { match: /^Link the listed exceptions/, field: 'quotes', label: 'Exceptions have no source quote', hint: 'No quote backs the listed exceptions. Add the sentence from the source that lists them and choose “The exceptions” for it.' },
];

/** The field an open question is about, from its words; the status card when it names no field. */
export function questionField(q: string): FixField {
  const t = q.toLowerCase();
  if (/jurisdiction|\bstate law|california|\bus-[a-z]{2}\b/.test(t)) return 'jurisdiction';
  if (/issuer|regulator|fincen|federal|issued by/.test(t)) return 'issuer';
  if (/in force|effective|\bdate\b/.test(t)) return 'effective';
  if (/quote|source text|wording/.test(t)) return 'quotes';
  if (/\bkind\b|regulation or|business rule/.test(t)) return 'kind';
  if (/evaluated for|whole case|one party|\bsubject\b/.test(t)) return 'subject';
  if (/process|account opening|opened|product line|channel|remote|branch|customer type/.test(t)) return 'process';
  if (/when (it|the rule|this rule) applies|condition|\bfact\b|applies to|minor|joint|age\b/.test(t)) return 'condition';
  return 'status';
}

/** Questions in an open_question flag (the server joins them with spaces). */
export const splitQuestions = (message: string) => message.split(/(?<=\?)\s+/).map((s) => s.trim()).filter(Boolean);

export interface FixInput {
  queueFlags?: { code: string; message: string }[];
  definitionProblems?: string[];
  evidenceProblems?: string[];
  body: Pick<PolicyRuleBody, 'library'>;
}

/** Every open problem as a "To fix" item, in page order (top to bottom), each pointing at its field. */
export function fixItems(d: FixInput): FixItem[] {
  const out: FixItem[] = [];
  const add = (flag: string, field: FixField, label: string, hint: string, question?: string) => out.push({ id: `${flag}:${field}:${out.length}`, flag, field, label, hint, ...(question ? { question } : {}) });
  for (const f of d.queueFlags ?? []) {
    if (f.code === 'condition_not_set') add(f.code, 'condition', 'When it applies is not set', 'When the rule applies is not set. Tick “Applies always within its process”, or write the condition, for example {"fact":"us_person","op":"eq","value":true}.');
    else if (f.code === 'condition_invalid') add(f.code, 'condition', 'The condition has a problem', `${f.message} Fix the condition, for example {"fact":"product","op":"eq","value":"teen_joint_account"}.`);
    else if (f.code === 'condition_not_quoted') add(f.code, 'quotes', 'No source quote says when it applies', 'No source quote says when this rule applies. In the quotes, add the sentence from the source that says when the rule applies and choose “When it applies” for it, or tick “Applies always within its process” in Library details.');
    else if (f.code === 'library_incomplete') {
      const lib = d.body.library ?? {};
      // The server's own list ("Missing for the policy library: issuer, scope."); the body only when the message has none.
      const listed = /Missing for the policy library: ([^.]+)\./.exec(f.message)?.[1]?.split(',').map((x) => (x.trim() === 'scope' ? 'process' : x.trim()));
      for (const k of LIBRARY_PARTS) {
        const value = k === 'process' ? lib.scope : lib[k];
        if (listed ? listed.includes(k) : value === undefined) add(f.code, k, LIBRARY_PART_FIX[k].label, LIBRARY_PART_FIX[k].hint);
      }
      const bad = lib.jurisdiction !== undefined ? jurisdictionProblem(lib.jurisdiction) : null;
      if (bad) add(f.code, 'jurisdiction', 'Jurisdiction is not a real code', `${bad} Enter US for federal or bank rules, or US-CA for California.`);
    } else if (f.code === 'no_effective_date') add(f.code, 'effective', 'In-force date is missing', 'There is no in-force date. Enter the date the rule is in force from, for example 2026-01-01, or choose “scenario only” under Takes effect when the rule has no date.');
    else if (f.code === 'not_ready') {
      const checks = [...(d.definitionProblems ?? []), ...(d.evidenceProblems ?? [])];
      const messages = checks.length ? checks : [f.message];
      for (const m of messages) {
        const c = CHECK_FIX.find((x) => x.match.test(m));
        if (c) add(f.code, c.field, c.label, c.hint);
        else add(f.code, 'status', m, m);
      }
    } else if (f.code === 'change_missing') add(f.code, 'change', 'Say how it changes the version before', 'This is a new version of an approved rule. Under “Change from the version before”, choose how it changes it (for example tightens) and write a short summary, for example “Age limit lowered from 17 to 16.”');
    else if (f.code === 'definition_not_approved') add(f.code, 'condition', 'A fact it uses is not approved yet', `${f.message} Open the rule that defines it from the review queue (its “Approve the definition first” row) and approve that one first.`);
    else if (f.code.startsWith('coverage_')) add(f.code, 'condition', 'Studio’s coverage answer needs a look', `${f.message} Check the condition uses facts the benchmark knows; change it if Studio names a gap.`);
    else if (f.code === 'open_question') {
      for (const q of splitQuestions(f.message)) {
        const field = questionField(q);
        add(f.code, field, `Open question: ${q.length > 70 ? `${q.slice(0, 67)}…` : q}`, 'Answer it by changing this field and saving; the question clears when you save the rule.', q);
      }
    } else if (f.code === 'needs_review' || f.code === 'outside_scope') add(f.code, 'status', f.code === 'needs_review' ? 'The AI asks for a careful read' : 'The AI thinks it is outside the library', `${f.message} Fix the rule, or exclude it if it does not belong in the library.`, f.message);
    else add(f.code, 'status', f.message, f.message);
  }
  // Top to bottom on the page: status card, Library details (selects, then the condition), then the edit form (quotes, then the text fields).
  const order: FixField[] = ['status', 'kind', 'issuer', 'jurisdiction', 'subject', 'process', 'change', 'condition', 'quotes', 'requirement', 'type', 'applies', 'effective'];
  return out.sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
}

/** The fixes for one field. */
export const fixesFor = (fixes: readonly FixItem[], field: FixField) => fixes.filter((f) => f.field === field);

/** Whether a field's hint should still show for the value typed so far (it goes away as soon as the field is filled). */
export function stillMissing(field: FixField, value: string): boolean {
  const v = value.trim();
  if (field === 'jurisdiction') return !v || !!jurisdictionProblem(v);
  return !v;
}
