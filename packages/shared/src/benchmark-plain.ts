/**
 * D-025 (owner, 23 Nov 2026): the Benchmark panel in plain business language for SMEs. Edge cases come from the live
 * template (tag, archetype, complexity, context, twist); this turns their codes into plain words and adds the business
 * context a compliance analyst needs (the real-world situation, why it matters to the bank, what a good analyst does and
 * the expected outcome). Notes are matched on the edge case's own words, so a new edge case still gets sensible text.
 * Never shown to SMEs: raw codes, defect numbers or system internals.
 */

const ACRONYMS: Record<string, string> = { dob: 'date of birth', tin: 'TIN', ssn: 'SSN', id: 'ID', pep: 'PEP', kyc: 'KYC', cip: 'CIP', ofac: 'OFAC' };
const humanize = (s: string) =>
  s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w)
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());

/** Plain names for archetypes (the kind of problem a case tests). Unknown ones are written out from their code. */
const ARCHETYPES: Record<string, string> = {
  sanctions_near_match: 'Possible sanctions match',
  missing_doc: 'Missing document or detail',
  missing_document: 'Missing document or detail',
  expired_doc: 'Expired document',
  address_mismatch: 'Address does not match',
  authority_gap: 'Unproven authority to act',
  pep: 'Politically exposed person',
  pep_hit: 'Politically exposed person',
  adverse_media: 'Negative news',
  conflicting_data: 'Information that does not agree',
  refer: 'Needs a specialist',
};
export const archetypePlain = (code: string | null | undefined) => (code ? (ARCHETYPES[code] ?? humanize(code)) : null);

/** Plain names for complexity (how much checking the case needs), with the meaning. */
const COMPLEXITY: Record<string, { name: string; meaning: string }> = {
  single_hop: { name: 'Single check', meaning: 'one document or one check settles it' },
  multi_hop: { name: 'Multi-step', meaning: 'you must cross-check two or more sources before deciding' },
};
export const complexityPlain = (code: string | null | undefined) => (code ? (COMPLEXITY[code] ?? { name: humanize(code), meaning: '' }) : null);

/** A plain name for an edge case: its own name, else its tag written out. */
export const edgeCasePlainName = (e: { name?: string | null; tag: string }) => e.name?.trim() || humanize(e.tag);

/** The dropdown label: "Sanctions dob mismatch — Possible sanctions match, multi-step". */
export function edgeCaseOptionLabel(e: { name?: string | null; tag: string; archetype?: string | null; complexity?: string | null }): string {
  const kind = archetypePlain(e.archetype);
  const effort = complexityPlain(e.complexity)?.name.toLowerCase();
  const extra = [kind, effort].filter(Boolean).join(', ');
  return extra ? `${edgeCasePlainName(e)} — ${extra}` : edgeCasePlainName(e);
}

export interface BusinessNote {
  topic: string;
  whyItMatters: string;
  goodAnalyst: string;
  usualOutcome: string;
}

/** Business context by topic, matched on the edge case's words (tag, archetype, context, twist). */
const NOTES: [RegExp, BusinessNote][] = [
  [
    /sanction|ofac|watch.?list|name match/i,
    {
      topic: 'Sanctions screening',
      whyItMatters: 'Opening an account for a sanctioned person is a serious legal breach (a false negative). Treating an innocent customer as sanctioned just because the name is similar (a false positive) wrongly refuses or delays a real customer. The bank must tell the two apart and record how it did.',
      goodAnalyst: 'Compares the hit with the applicant on more than the name: date of birth, nationality, address and ID numbers. If the identifiers clearly differ, documents why it is not the same person; if they cannot be ruled out, escalates.',
      usualOutcome: 'Cleared with the reasoning recorded when identifiers clearly differ; referred to a sanctions specialist when it cannot be ruled out. Never approved without the check, and never refused on the name alone.',
    },
  ],
  [
    /tin|taxpayer|ssn|tax id/i,
    {
      topic: 'Taxpayer ID (TIN) for every account holder',
      whyItMatters: 'The bank’s customer identification program (CIP) requires an identification number for each person on the account, minors included. An account opened without it breaks the rule and blocks tax reporting.',
      goodAnalyst: 'Checks that every party, including a minor, has a TIN or a recorded, allowed reason why not (for example one applied for), and does not approve until it is resolved.',
      usualOutcome: 'Request the missing TIN (or proof it has been applied for) from the parent or guardian before the account is approved.',
    },
  ],
  [
    /address|residen|passport.?only|proof of address|utility/i,
    {
      topic: 'Address verification (CIP)',
      whyItMatters: 'CIP requires the bank to verify a residential address, not just identity. A passport proves who someone is but not where they live, so the address stays unverified.',
      goodAnalyst: 'Sees that identity is proven but the address is not, and asks for an acceptable proof of address (a recent utility bill, bank statement or lease) or uses an allowed non-documentary check.',
      usualOutcome: 'Request information: ask for a proof of address before approving.',
    },
  ],
  [
    /expir|out of date|lapsed/i,
    {
      topic: 'Expired identity document',
      whyItMatters: 'Under CIP, identity must be verified with a document that is valid on the application date. An expired licence or passport does not count, even if the person in it is clearly the applicant.',
      goodAnalyst: 'Checks the expiry date against the application date, notes the gap, and asks for a current document instead of accepting the expired one.',
      usualOutcome: 'Request information: a current, unexpired ID before the account is approved.',
    },
  ],
  [
    /authority|custodian|guardian|power of attorney|on behalf/i,
    {
      topic: 'Authority to act for someone else',
      whyItMatters: 'Someone opening or running an account for another person (a child, a ward, a client) must prove they are allowed to. Without proof the bank could hand control of the account to the wrong person.',
      goodAnalyst: 'Asks for the document that grants the authority (court order, custodial agreement, power of attorney) and checks it covers this account.',
      usualOutcome: 'Request the authority document; refer to a specialist if it is unclear.',
    },
  ],
];

export function businessNotes(e: { tag: string; archetype?: string | null; context?: string | null; twist?: string | null }): BusinessNote[] {
  const text = [e.tag, e.archetype, e.context, e.twist].filter(Boolean).join(' ');
  return NOTES.filter(([re]) => re.test(text)).map(([, n]) => n);
}

const PRODUCTS: Record<string, string> = { individual: 'Individual account', adult_joint: 'Joint account (adults)', teen_joint: 'Teen joint account (minor with an adult)', custodial: 'Custodial account' };

/**
 * D-027: an option as an SME should read it. A real label wins; a label that is just the code is replaced by a plain name
 * (archetype, complexity, product, or the code written out). Applies to every section's pick lists.
 */
export function optionPlainLabel(o: { value: string; label?: string | null }): string {
  const label = o.label?.trim();
  if (label && label !== o.value) return label;
  const v = o.value;
  return ARCHETYPES[v] ?? COMPLEXITY[v]?.name ?? PRODUCTS[v] ?? (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(v) ? humanize(v) : label || v);
}

/** When to choose a value, in plain words, where known (complexity and archetype). */
export function optionWhenToChoose(value: string): string | null {
  if (COMPLEXITY[value]?.meaning) return `Choose when ${COMPLEXITY[value]!.meaning}.`;
  const a: Record<string, string> = {
    sanctions_near_match: 'Choose when the case turns on a screening hit that may or may not be the same person.',
    missing_doc: 'Choose when a required document or detail is missing or not acceptable (no TIN, no proof of address, an expired ID).',
    policy_conflict: 'Choose when two rules or sources point to different answers and the analyst must decide which applies.',
  };
  return a[value] ?? null;
}
