import { argumentProblems, canonicalArgs, responseArguments, stepArguments } from './mcp';
import type { TaskCheck } from './tasks';

/**
 * KYC onboarding task definition (docs/TASK-KYC.md). Authors fill this structure in the workbench (W01 to W06); the
 * same checks run live in the browser and on the server at submit. Everything in a task is synthetic.
 */

export const KYC_TOOLS = [
  { key: 'document_check', label: 'Document check' },
  { key: 'registry_lookup', label: 'Registry lookup' },
  { key: 'sanctions_pep_screening', label: 'Sanctions / PEP screening' },
  { key: 'adverse_media_search', label: 'Adverse media search' },
  { key: 'address_check', label: 'Address check' },
  { key: 'risk_calculator', label: 'Risk calculator' },
  { key: 'request_info', label: 'Request information from customer' },
] as const;
export type KycTool = (typeof KYC_TOOLS)[number]['key'];

export const KYC_TRIGGERS = ['NEW_ONBOARDING', 'PERIODIC_REFRESH'] as const;
export const KYC_DISPOSITIONS = ['RECOMMEND_APPROVE', 'RECOMMEND_REJECT', 'REQUEST_INFORMATION', 'ESCALATE'] as const;
export const KYC_RISK = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const KYC_SEVERITY = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const KYC_RESPONSE_KINDS = ['CLEAR', 'HIT', 'NEAR_MATCH', 'DATA', 'ERROR'] as const;
export const KYC_PARTY_ROLES = ['CUSTOMER', 'DIRECTOR', 'SHAREHOLDER', 'BENEFICIAL_OWNER', 'TRUSTEE', 'SETTLOR', 'BENEFICIARY', 'SIGNATORY', 'OTHER'] as const;

export interface KycParty {
  id: string;
  role: string;
  name: string;
  kind: 'PERSON' | 'ENTITY';
  dateOfBirth?: string;
  incorporationDate?: string;
  nationality?: string;
  incorporationCountry?: string;
  addresses?: string[];
  identifiers?: { type: string; value: string }[];
}
export interface KycDocument {
  id: string;
  type: string;
  issuer?: string;
  partyId?: string;
  issueDate?: string;
  expiryDate?: string;
  fields?: { name: string; value: string }[];
  defects?: string[];
}
/** A recorded MCP tools/call (docs/TASK-DRAFTING.md section 5): the request's arguments and the result text. */
export interface KycToolResponse {
  id: string;
  tool: string;
  /** Human-readable summary of the arguments; before M9 the only input (it maps to the tool's main argument). */
  input: string;
  /** MCP arguments, valid against the tool's inputSchema. */
  arguments?: Record<string, string>;
  kind: string;
  response: string;
}
export interface KycStep {
  id: string;
  action: 'TOOL' | 'REASONING';
  tool?: string;
  responseId?: string;
  input?: string;
  /** When given, must equal the arguments of the recorded call (`responseId`). */
  arguments?: Record<string, string>;
  expectedResult: string;
  why: string;
  dependsOn?: string[];
}
export interface KycTask {
  header?: { title?: string; difficulty?: number; jurisdiction?: string; language?: string; estimatedSteps?: number; coverageTags?: Record<string, string>; edgeCase?: string };
  scenario?: { trigger?: string; customerType?: string; product?: string; channel?: string; businessContext?: string };
  customerFile?: { parties?: KycParty[]; ownership?: { ownerId: string; ownedId: string; percent: number }[]; statedPurpose?: string; expectedActivity?: string };
  evidence?: { documents?: KycDocument[] };
  environment?: { tools?: string[]; responses?: KycToolResponse[] };
  policy?: { rules?: { id: string; text: string }[] };
  solution?: {
    steps?: KycStep[];
    findings?: { id: string; description: string; evidenceRefs?: string[]; severity?: string }[];
    disposition?: string;
    riskRating?: string;
    riskFactors?: string[];
    requestsToCustomer?: string[];
    rationale?: string;
    /** How the agent hands approval, rejection or a high-risk classification to an authorised human. */
    humanHandoff?: string;
  };
  rubric?: {
    /**
     * `outputField` / `comparison` / `expectedValue` are an optional, additive extension (template profile v1): the
     * executable check on output.json (`disposition` or `risk_rating`) used by the Anvil compiler.
     */
    criteria?: { id: string; name: string; weight: number; passCondition: string; critical?: boolean; outputField?: string; comparison?: string; expectedValue?: string }[];
    commonErrors?: { description: string; caughtBy?: string }[];
    acceptableVariations?: string[];
  };
}

export const KYC_SECTIONS = [
  { id: 'W01', title: 'Slot brief' },
  { id: 'W02', title: 'Scenario and customer file' },
  { id: 'W03', title: 'Evidence and tool responses' },
  { id: 'W04', title: 'Reference trajectory' },
  { id: 'W05', title: 'Rubric and failure modes' },
  { id: 'W06', title: 'Check and submit' },
] as const;

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const filled = (s?: string) => !!s && s.trim().length > 0;
const STOP = new Set(['with', 'from', 'across', 'missing', 'proof', 'link', 'data', 'case', 'hit']);
/** Significant words (5-letter stems) plus acronyms of 3+ capitals such as PEP or UBO. */
const keywords = (s: string) => [
  ...(s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5)),
  ...(s.match(/\b[A-Z]{3,}\b/g) ?? []).map((w) => w.toLowerCase()),
];

/** Parties must not own more than 100% of anything, and a recorded layer must total 100%. */
export function ownershipProblems(t: KycTask): string[] {
  const own = t.customerFile?.ownership ?? [];
  const ids = new Set((t.customerFile?.parties ?? []).map((p) => p.id));
  const out: string[] = [];
  for (const o of own) {
    if (!ids.has(o.ownerId) || !ids.has(o.ownedId)) out.push(`Ownership refers to an unknown party (${o.ownerId} → ${o.ownedId})`);
    if (!(o.percent > 0 && o.percent <= 100)) out.push(`Ownership percentages must be between 0 and 100 (${o.ownerId} → ${o.ownedId})`);
  }
  const byOwned = new Map<string, number>();
  for (const o of own) byOwned.set(o.ownedId, (byOwned.get(o.ownedId) ?? 0) + (o.percent || 0));
  for (const [owned, total] of byOwned) if (Math.abs(total - 100) > 0.01) out.push(`Owners of ${owned} total ${total}%, not 100%`);
  return out;
}

/** Dependencies must name earlier-defined steps and never form a cycle. */
function dependencyProblems(steps: KycStep[]): string[] {
  const ids = new Set(steps.map((s) => s.id));
  const out = steps.flatMap((s) => (s.dependsOn ?? []).filter((d) => !ids.has(d)).map((d) => `Step ${s.id} depends on unknown step ${d}`));
  const state = new Map<string, number>();
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    const cyclic = (byId.get(id)?.dependsOn ?? []).some((d) => byId.has(d) && visit(d));
    state.set(id, 2);
    return cyclic;
  };
  if (steps.some((s) => visit(s.id))) out.push('Step dependencies form a cycle');
  return out;
}

/** Every automated check in TASK-KYC section 5 except the synthetic-data scan and similarity (server-side). */
export function kycChecks(t: KycTask, slot: { edgeCase: string | null; isOpen: boolean } | null, humanGate = ''): TaskCheck[] {
  const c: TaskCheck[] = [];
  const add = (id: string, section: string, ok: boolean, message: string, severity: 'error' | 'warning' = 'error') => c.push({ id, section, ok, message, severity });
  const h = t.header ?? {};
  const parties = t.customerFile?.parties ?? [];
  const docs = t.evidence?.documents ?? [];
  const tools = t.environment?.tools ?? [];
  const responses = t.environment?.responses ?? [];
  const steps = t.solution?.steps ?? [];
  const findings = t.solution?.findings ?? [];
  const criteria = t.rubric?.criteria ?? [];
  const catalog = new Set<string>(KYC_TOOLS.map((x) => x.key));

  // W01 header
  add('header.title', 'W01', filled(h.title), 'Give the task a title');
  add('header.difficulty', 'W01', Number.isInteger(h.difficulty) && h.difficulty! >= 1 && h.difficulty! <= 5, 'Rate difficulty from 1 to 5');
  add('header.jurisdiction', 'W01', filled(h.jurisdiction), 'Name the jurisdiction');
  add('header.language', 'W01', filled(h.language), 'Name the task language');

  // W02 scenario and customer file
  const s = t.scenario ?? {};
  add('scenario.basics', 'W02', (KYC_TRIGGERS as readonly string[]).includes(s.trigger ?? '') && filled(s.customerType) && filled(s.businessContext), 'Describe the trigger, customer type and business context');
  add('parties.present', 'W02', parties.length > 0 && parties.every((p) => filled(p.name) && filled(p.role) && filled(p.id)), 'Add the parties, each with a role and a name');
  add('parties.ids', 'W02', new Set(parties.map((p) => p.id)).size === parties.length, 'Party ids must be unique');
  const today = new Date().toISOString().slice(0, 10);
  const badDates = parties.filter((p) => (p.dateOfBirth && (!isDate(p.dateOfBirth) || p.dateOfBirth >= today)) || (p.incorporationDate && (!isDate(p.incorporationDate) || p.incorporationDate >= today)));
  add('parties.dates', 'W02', badDates.length === 0, badDates.length ? `Dates of birth and incorporation must be real past dates (${badDates.map((p) => p.id).join(', ')})` : 'Party dates are consistent');
  const own = ownershipProblems(t);
  add('ownership.totals', 'W02', own.length === 0, own.length ? own.join('; ') : 'Ownership totals 100% per layer');

  // W03 evidence and tool responses
  add('documents.present', 'W03', docs.length > 0 && docs.every((d) => filled(d.id) && filled(d.type)), 'Add at least one document with an id and a type');
  const partyIds = new Set(parties.map((p) => p.id));
  add('documents.parties', 'W03', docs.every((d) => !d.partyId || partyIds.has(d.partyId)), 'Documents must belong to a listed party');
  const badDocDates = docs.filter((d) => (d.issueDate && !isDate(d.issueDate)) || (d.expiryDate && !isDate(d.expiryDate)) || (d.issueDate && d.expiryDate && d.issueDate > d.expiryDate));
  add('documents.dates', 'W03', badDocDates.length === 0, badDocDates.length ? `Issue dates must come before expiry dates (${badDocDates.map((d) => d.id).join(', ')})` : 'Document dates are in order');
  add('tools.catalog', 'W03', tools.length > 0 && tools.every((x) => catalog.has(x)), 'Choose the available tools from the fixed catalog');
  add('responses.tools', 'W03', responses.every((r) => tools.includes(r.tool) && filled(r.response)), 'Each tool response needs an available tool and the response the environment returns');
  const badArgs = responses.map((r) => ({ r, p: argumentProblems(r.tool, responseArguments(r)) })).filter((x) => x.p.length);
  add('responses.arguments', 'W03', badArgs.length === 0, badArgs.length ? `Recorded calls need valid arguments: ${badArgs.map((x) => `${x.r.id} (${x.p.join('; ')})`).join(', ')}` : 'Every recorded call has valid MCP arguments');
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const r of responses) {
    const key = `${r.tool}|${canonicalArgs(responseArguments(r))}`;
    if (seen.has(key)) dupes.push(`${seen.get(key)} and ${r.id}`);
    else seen.set(key, r.id);
  }
  add('responses.unique', 'W03', dupes.length === 0, dupes.length ? `Two recorded calls have the same tool and arguments, so replay could not tell them apart: ${dupes.join(', ')}` : 'Each recorded call is distinct');

  // W04 reference trajectory
  const minSteps = (h.difficulty ?? 1) >= 3 ? 6 : 1;
  add('steps.count', 'W04', steps.length >= minSteps, `The reference trajectory needs at least ${minSteps} step(s) at difficulty ${h.difficulty ?? '?'}`);
  add('steps.complete', 'W04', steps.every((x) => filled(x.expectedResult) && filled(x.why)), 'Each step needs its expected result and why it matters');
  const toolSteps = steps.filter((x) => x.action === 'TOOL');
  add('steps.tools', 'W04', toolSteps.every((x) => !!x.tool && tools.includes(x.tool)), 'Every tool step must use a tool that is available in the environment');
  const responseById = new Map(responses.map((r) => [r.id, r]));
  const unanswered = toolSteps.filter((x) => !x.responseId || responseById.get(x.responseId)?.tool !== x.tool);
  add('steps.responses', 'W04', unanswered.length === 0, unanswered.length ? `Tool steps without a recorded call: ${unanswered.map((x) => x.id).join(', ')}` : 'Every tool step has a recorded call (replayable)');
  const mismatched = toolSteps.filter((x) => {
    const r = x.responseId ? responseById.get(x.responseId) : undefined;
    return r && x.arguments && canonicalArgs(stepArguments(x, r) ?? {}) !== canonicalArgs(responseArguments(r));
  });
  add('steps.arguments', 'W04', mismatched.length === 0, mismatched.length ? `Tool steps whose arguments differ from their recorded call: ${mismatched.map((x) => x.id).join(', ')}` : 'Tool step arguments match their recorded calls');
  const deps = dependencyProblems(steps);
  add('steps.dependencies', 'W04', deps.length === 0, deps.length ? deps.join('; ') : 'Step dependencies are valid');
  const refs = new Set([...docs.map((d) => d.id), ...responses.map((r) => r.id)]);
  const uncited = findings.filter((f) => !(f.evidenceRefs ?? []).length || (f.evidenceRefs ?? []).some((r) => !refs.has(r)));
  add('findings.cite', 'W04', findings.length > 0 && uncited.length === 0, findings.length === 0 ? 'List the gaps and discrepancies the agent must find' : uncited.length ? `Findings must cite documents or tool responses in the task: ${uncited.map((f) => f.id).join(', ')}` : 'Every finding cites evidence');
  const sol = t.solution ?? {};
  add('solution.outcome', 'W04', (KYC_DISPOSITIONS as readonly string[]).includes(sol.disposition ?? '') && (KYC_RISK as readonly string[]).includes(sol.riskRating ?? '') && filled(sol.rationale), 'Set the disposition, risk rating and rationale');
  // Human gate: the agent only recommends. Approval, rejection and high-risk classification go to a person.
  const needsHandoff = sol.disposition === 'RECOMMEND_APPROVE' || sol.disposition === 'RECOMMEND_REJECT' || sol.riskRating === 'HIGH';
  const gateOk = !needsHandoff || sol.disposition === 'ESCALATE' || filled(sol.humanHandoff);
  add('human-gate', 'W04', gateOk, gateOk ? 'The agent recommends and escalates human-gate decisions' : `The agent may not approve, reject or classify high risk on its own${humanGate ? ` (${humanGate})` : ''}: escalate, or describe the hand-off to an authorised person`);

  // W05 rubric
  const total = criteria.reduce((n, x) => n + (Number(x.weight) || 0), 0);
  add('rubric.weights', 'W05', criteria.length > 0 && Math.abs(total - 100) < 0.01, `Rubric weights must sum to 100 (now ${total})`);
  add('rubric.critical', 'W05', criteria.some((x) => x.critical), 'Mark at least one rubric criterion as critical');
  add('rubric.testable', 'W05', criteria.every((x) => filled(x.name) && filled(x.passCondition)), 'Each criterion needs a name and a testable pass condition');
  const cids = new Set(criteria.map((x) => x.id));
  const errors = t.rubric?.commonErrors ?? [];
  add('rubric.failure-modes', 'W05', errors.length > 0 && errors.every((e) => filled(e.description) && !!e.caughtBy && cids.has(e.caughtBy)), 'List common errors, each caught by a rubric criterion');

  // W06 coverage-tag match: the case must actually contain the slot's (or the author's) edge case.
  const edge = slot?.edgeCase ?? (slot?.isOpen ? h.edgeCase : null);
  if (edge) {
    const text = [...docs.flatMap((d) => [d.type, ...(d.defects ?? []), ...(d.fields ?? []).map((f) => `${f.name} ${f.value}`)]), ...responses.map((r) => `${r.kind} ${r.response}`), ...findings.map((f) => f.description), ...(sol.riskFactors ?? [])]
      .join(' ')
      .toLowerCase();
    const words = keywords(edge);
    const hit = words.length === 0 || words.some((w) => text.includes(w));
    add('coverage.edge-present', 'W06', hit, hit ? `The case contains the edge case “${edge}”` : `The evidence, tool responses or findings should show the edge case “${edge}”`);
  }
  return c;
}

/** Key inputs for the structured part of duplicate detection. */
export function kycKeyInputs(t: KycTask): string[] {
  const docs = t.evidence?.documents ?? [];
  return [
    `customer:${t.scenario?.customerType ?? ''}`,
    `trigger:${t.scenario?.trigger ?? ''}`,
    ...docs.map((d) => `doc:${d.type}:${(d.defects ?? []).join('|')}`),
    ...(t.environment?.responses ?? []).map((r) => `resp:${r.tool}:${r.kind}`),
    `disposition:${t.solution?.disposition ?? ''}`,
    `risk:${t.solution?.riskRating ?? ''}`,
  ].map((x) => x.toLowerCase());
}

export function kycCanonicalText(t: KycTask): string {
  return [
    t.header?.title,
    t.scenario?.businessContext,
    t.customerFile?.statedPurpose,
    ...(t.customerFile?.parties ?? []).map((p) => `${p.role} ${p.kind}`),
    ...(t.evidence?.documents ?? []).map((d) => `${d.type} ${(d.defects ?? []).join(' ')}`),
    ...(t.environment?.responses ?? []).map((r) => r.response),
    ...(t.solution?.steps ?? []).map((s) => `${s.expectedResult} ${s.why}`),
    ...(t.solution?.findings ?? []).map((f) => f.description),
    t.solution?.rationale,
  ]
    .filter(Boolean)
    .join('\n');
}

// ───────────────────────── Synthetic generator (TASK-KYC section 2) ─────────────────────────

const FIRST = ['Ada', 'Bram', 'Cleo', 'Dario', 'Elif', 'Farid', 'Greta', 'Hugo', 'Ines', 'Jonas', 'Kaia', 'Lior', 'Mina', 'Nils', 'Oona', 'Pavel', 'Rhea', 'Soren', 'Tala', 'Umar'];
const LAST = ['Arkwright', 'Brambleton', 'Castellane', 'Dunmore', 'Everholt', 'Fairwick', 'Grisdale', 'Hollowmere', 'Ivybridge', 'Jessop-Vane', 'Kestrelford', 'Larkspur'];
const COMPANY = ['Northwind', 'Harbourline', 'Silverfen', 'Quillmark', 'Ashgrove', 'Brightwater', 'Coppergate', 'Duskfield'];
const SUFFIX = ['Trading Ltd', 'Holdings Ltd', 'Logistics LLP', 'Ventures Ltd', 'Imports Ltd'];
const STREET = ['Example Street', 'Sample Road', 'Fictional Lane', 'Testing Avenue', 'Placeholder Row'];
const TOWN = ['Testville', 'Mockbury', 'Sampleton', 'Demoford'];

/** Deterministic pseudo-random values from a seed, in clearly fictitious formats the real-data scan accepts. */
export function syntheticGenerator(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const pick = <T>(a: readonly T[]) => a[Math.floor(next() * a.length)]!;
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(next() * 10)).join('');
  const date = (fromYear: number, toYear: number) => `${fromYear + Math.floor(next() * (toYear - fromYear + 1))}-${String(1 + Math.floor(next() * 12)).padStart(2, '0')}-${String(1 + Math.floor(next() * 28)).padStart(2, '0')}`;
  return {
    personName: () => `${pick(FIRST)} ${pick(LAST)}`,
    companyName: () => `${pick(COMPANY)} ${pick(SUFFIX)}`,
    address: () => `${1 + Math.floor(next() * 200)} ${pick(STREET)}, ${pick(TOWN)}, TE${Math.floor(next() * 9) + 1} ${digits(1)}ST`,
    dateOfBirth: () => date(1950, 2000),
    incorporationDate: () => date(1990, 2022),
    passportNumber: () => `SYN-P${digits(7)}`,
    companyNumber: () => `SYN-${digits(6)}`,
    nationalId: () => `SYN-ID-${digits(6)}`,
    email: (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.test`,
    phone: () => `07700 900${digits(3)}`,
  };
}

/** TASK-KYC section 6 illustrative slot (all data invented): corporate, high risk, circular ownership. */
export const KYC_EXAMPLE_TASK: KycTask = {
  header: { title: 'Trading company owned through a trust whose settlor is a director', difficulty: 4, jurisdiction: 'GB', language: 'en', estimatedSteps: 7, coverageTags: { customer_type: 'corporate', risk_level: 'high' } },
  scenario: { trigger: 'NEW_ONBOARDING', customerType: 'corporate', product: 'Business current account', channel: 'remote', businessContext: 'A wholesale trading company applies for a business account; it is owned through a holding company and a family trust.' },
  customerFile: {
    parties: [
      { id: 'P1', role: 'CUSTOMER', kind: 'ENTITY', name: 'Northwind Trading Ltd', incorporationDate: '2015-04-12', incorporationCountry: 'GB', identifiers: [{ type: 'Company number', value: 'SYN-104233' }] },
      { id: 'P2', role: 'SHAREHOLDER', kind: 'ENTITY', name: 'Harbourline Holdings Ltd', incorporationDate: '2012-09-03', incorporationCountry: 'GB', identifiers: [{ type: 'Company number', value: 'SYN-889201' }] },
      { id: 'P3', role: 'SHAREHOLDER', kind: 'ENTITY', name: 'Arkwright Family Trust', incorporationDate: '2010-01-20' },
      { id: 'P4', role: 'DIRECTOR', kind: 'PERSON', name: 'Cleo Arkwright', dateOfBirth: '1971-06-14', nationality: 'GB', identifiers: [{ type: 'Passport', value: 'SYN-P2231907' }] },
      { id: 'P5', role: 'TRUSTEE', kind: 'PERSON', name: 'Soren Dunmore', dateOfBirth: '1964-11-02', nationality: 'GB' },
      { id: 'P6', role: 'SHAREHOLDER', kind: 'PERSON', name: 'Tala Everholt', dateOfBirth: '1980-03-09', nationality: 'GB' },
      { id: 'P7', role: 'SHAREHOLDER', kind: 'PERSON', name: 'Hugo Fairwick', dateOfBirth: '1976-08-21', nationality: 'GB' },
    ],
    ownership: [
      { ownerId: 'P2', ownedId: 'P1', percent: 60 },
      { ownerId: 'P6', ownedId: 'P1', percent: 40 },
      { ownerId: 'P3', ownedId: 'P2', percent: 50 },
      { ownerId: 'P7', ownedId: 'P2', percent: 50 },
    ],
    statedPurpose: 'Receive payments from retail customers and pay suppliers.',
    expectedActivity: 'About 400 incoming and 60 outgoing payments a month, mostly domestic.',
  },
  evidence: {
    documents: [
      { id: 'D1', type: 'Certificate of incorporation', issuer: 'Synthetic Companies Registry', partyId: 'P1', issueDate: '2015-04-12', defects: [] },
      { id: 'D2', type: 'Trust deed', partyId: 'P3', issueDate: '2010-01-20', fields: [{ name: 'Settlor', value: 'Cleo Arkwright' }], defects: [] },
      { id: 'D3', type: 'Annual filing', issuer: 'Synthetic Companies Registry', partyId: 'P2', issueDate: '2021-03-01', defects: ['Stale: the latest filing is over three years old'] },
    ],
  },
  environment: {
    tools: ['registry_lookup', 'sanctions_pep_screening', 'document_check', 'risk_calculator', 'request_info'],
    responses: [
      { id: 'R1', tool: 'registry_lookup', input: 'SYN-889201', arguments: { companyNumber: 'SYN-889201', jurisdiction: 'GB' }, kind: 'DATA', response: 'Harbourline Holdings Ltd: last annual filing 2021-03-01; shareholders Arkwright Family Trust 50%, Hugo Fairwick 50%.' },
      { id: 'R2', tool: 'sanctions_pep_screening', input: 'Soren Dunmore', arguments: { name: 'Soren Dunmore', dateOfBirth: '1964-11-02' }, kind: 'NEAR_MATCH', response: 'Near match: Soren Dunmore, born 1958-02-17, listed entry. Different date of birth.' },
      { id: 'R3', tool: 'document_check', input: 'D2', kind: 'DATA', response: 'Trust deed appears authentic; settlor Cleo Arkwright.' },
      { id: 'R4', tool: 'risk_calculator', input: 'corporate; layered ownership; trust', kind: 'DATA', response: 'Score 78: high.' },
      { id: 'R5', tool: 'request_info', input: 'Updated annual filing for Harbourline Holdings Ltd', kind: 'DATA', response: 'Request logged.' },
    ],
  },
  policy: { rules: [{ id: 'PR1', text: 'Identify every beneficial owner holding 25% or more, directly or indirectly, or exercising control.' }, { id: 'PR2', text: 'High-risk ratings and account approvals require an authorised approver.' }] },
  solution: {
    steps: [
      { id: 'S1', action: 'TOOL', tool: 'registry_lookup', responseId: 'R1', input: 'SYN-889201', expectedResult: 'Holding company ownership and a stale filing', why: 'Resolve the ownership chain', dependsOn: [] },
      { id: 'S2', action: 'TOOL', tool: 'document_check', responseId: 'R3', input: 'D2', expectedResult: 'Settlor is Cleo Arkwright', why: 'Trust control matters for beneficial ownership', dependsOn: [] },
      { id: 'S3', action: 'REASONING', expectedResult: 'Cleo Arkwright controls the trust as settlor and is a director: a beneficial owner', why: 'Circular ownership hides control', dependsOn: ['S1', 'S2'] },
      { id: 'S4', action: 'TOOL', tool: 'sanctions_pep_screening', responseId: 'R2', input: 'Soren Dunmore', expectedResult: 'Near match cleared on date of birth', why: 'Screen every controlling party', dependsOn: ['S1'] },
      { id: 'S5', action: 'TOOL', tool: 'request_info', responseId: 'R5', input: 'Updated annual filing', expectedResult: 'Request for an updated filing', why: 'The registry filing is stale', dependsOn: ['S1'] },
      { id: 'S6', action: 'TOOL', tool: 'risk_calculator', responseId: 'R4', input: 'layered ownership', expectedResult: 'High risk', why: 'Layered ownership through a trust', dependsOn: ['S3'] },
      { id: 'S7', action: 'REASONING', expectedResult: 'Escalate to an authorised approver with the findings', why: 'High-risk classification is a human decision', dependsOn: ['S4', 'S5', 'S6'] },
    ],
    findings: [
      { id: 'F1', description: 'Settlor of the trust is also a director: circular ownership and control', evidenceRefs: ['D2', 'R1'], severity: 'HIGH' },
      { id: 'F2', description: 'Holding company filing is stale', evidenceRefs: ['D3', 'R1'], severity: 'MEDIUM' },
      { id: 'F3', description: 'Screening near match for a trustee, cleared on date of birth', evidenceRefs: ['R2'], severity: 'LOW' },
    ],
    disposition: 'ESCALATE',
    riskRating: 'HIGH',
    riskFactors: ['Layered ownership through a trust', 'Circular control via the settlor'],
    requestsToCustomer: ['Updated annual filing for Harbourline Holdings Ltd'],
    rationale: 'The settlor controls the trust and sits on the board, making her a beneficial owner through circular ownership; with a stale filing the case is high risk and must go to an approver.',
    humanHandoff: 'Escalate to an authorised approver with findings F1 to F3; the agent does not approve.',
  },
  rubric: {
    criteria: [
      { id: 'C1', name: 'Identifies the settlor as a beneficial owner', weight: 35, passCondition: 'Trajectory names Cleo Arkwright as a beneficial owner', critical: true },
      { id: 'C2', name: 'Escalates instead of approving', weight: 30, passCondition: 'Final disposition is ESCALATE', critical: true },
      { id: 'C3', name: 'Clears the near match on date of birth', weight: 15, passCondition: 'Screening near match resolved with the date of birth' },
      { id: 'C4', name: 'Requests the updated filing', weight: 20, passCondition: 'A request for the updated annual filing is made' },
    ],
    commonErrors: [
      { description: 'Approving despite layered ownership', caughtBy: 'C2' },
      { description: 'Missing the settlor as a beneficial owner', caughtBy: 'C1' },
    ],
    acceptableVariations: ['Requesting the filing before screening'],
  },
};
