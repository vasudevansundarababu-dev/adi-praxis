/**
 * D-016 (owner, 23 Nov 2026): procedure steps (S5.steps) had the wrong tool ("screen applicants" on specialist.refer),
 * and S5 reaches the agent verbatim. This is the owner's tool guide, shared by the SME's Tool picker, the drafter that
 * turns the SME's business sentences into steps, and the step checks at save, submit and review.
 *
 * A step has one main tool. What happens only under a condition goes in the step's conditional follow-ups, stored in
 * the step as `followUps: [{ if, tools }]` (S5 reaches the RL Gym with them). A follow-up without a condition is only
 * the continuation of a two-tool chain the guide names (documents.list → document.read).
 */

/** The owner's guide, in the owner's words: what each tool is used for. */
export const OWNER_TOOL_GUIDE: Readonly<Record<string, string>> = {
  'application.read': 'Retrieve the assigned application and identify its parties',
  'documents.list': 'Find supporting documents, then read a specific one',
  'identity.check': 'Verify a party’s identity',
  'address.check': 'Verify a party’s address',
  'authority.check': 'Check the adult’s or custodian’s claimed authority',
  'screening.check': 'Screen an applicant',
  'finding.write': 'Record a discrepancy found during a check',
  'information.request': 'Request missing evidence',
  'specialist.refer': 'Route an unresolved issue to a specialist when policy requires it',
  recommend: 'Submit the final onboarding recommendation',
};

/** Purposes Authoring added for the other tools a KYC template offers (not in the owner's guide; change on request). */
export const ADDED_TOOL_PURPOSES: Readonly<Record<string, string>> = {
  'parties.list': 'List the parties on the application (applicants, adults, custodians)',
  'document.read': 'Read a specific supporting document (after documents.list)',
  'policy.read': 'Read the policy rule that applies',
  'document.check': 'Check a document’s validity (type, expiry, signs of tampering)',
  'document.compare': 'Compare a document with the application or with another document',
  'operation.lookup': 'Look up a pending operation on the case',
  'operation.read': 'Read the result of a pending operation',
  'information.read': 'Read the customer’s reply to an information request',
  'finding.resolve': 'Close a recorded finding once the evidence resolves it',
  'specialist.read': 'Read the specialist’s answer to a referral',
  search: 'Search the case’s records for supporting information',
  'search.read': 'Read a search result',
};

export const TOOL_PURPOSE: Readonly<Record<string, string>> = { ...OWNER_TOOL_GUIDE, ...ADDED_TOOL_PURPOSES };

/** Two-tool chains the guide allows on one step: the main tool, then these without a condition. */
export const TOOL_CHAINS: Readonly<Record<string, readonly string[]>> = { 'documents.list': ['document.read'] };

/** Tools that act only when a check found a problem: a conditional follow-up, never a step's main tool. */
export const CONDITIONAL_TOOLS: readonly string[] = ['finding.write', 'specialist.refer'];

/** Picker label: "<purpose> — <tool>" (chains show both tools). Unknown tools show their ID only. */
export function toolOptionLabel(id: string): string {
  const purpose = TOOL_PURPOSE[id];
  const chain = TOOL_CHAINS[id];
  const tools = chain?.length ? [id, ...chain].join(' → ') : id;
  return purpose ? `${purpose} — ${tools}` : id;
}

/** The guide's order first (owner's, then added), then any other offered tool. */
export function orderedTools(offered: readonly string[]): string[] {
  const known = Object.keys(TOOL_PURPOSE);
  return [...known.filter((k) => offered.includes(k)), ...offered.filter((k) => !known.includes(k))];
}

export interface StepFollowUp {
  /** The condition, in plain words ("either applicant has an unresolved match"). Empty only for a chain continuation. */
  if?: string;
  tools: string[];
}
export interface ProcedureStep {
  action: string;
  tool?: string;
  failureBehaviour?: string;
  followUps?: StepFollowUp[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The step's follow-ups as stored, cleaned: only records with at least one tool name. */
export function followUpsOf(step: unknown): StepFollowUp[] {
  if (!isObj(step) || !Array.isArray(step.followUps)) return [];
  return step.followUps.filter(isObj).flatMap((f) => {
    const tools = (Array.isArray(f.tools) ? f.tools : []).filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim());
    if (!tools.length) return [];
    const cond = typeof f.if === 'string' ? f.if.trim() : '';
    return [cond ? { if: cond, tools } : { tools }];
  });
}

// Words that say which tool a sentence is about. The most specific purposes come first.
const SIGNALS: [string, RegExp][] = [
  ['screening.check', /\bscreen|sanction|watch-?list|\bpep\b|politically exposed|adverse media/i],
  ['address.check', /\baddress|residen|proof of address|utility bill/i],
  ['authority.check', /authority|power of attorney|guardianship|legal guardian|act(s|ing)? on behalf/i],
  ['identity.check', /identit|\bid\b|passport|driver.?s licen|photo id|government id/i],
  ['document.check', /(document|passport|licen[cs]e).{0,40}(valid|expir|tamper|authentic|genuine)|\bexpir/i],
  ['document.compare', /\bcompare|cross-?check|consisten|against the application/i],
  ['recommend', /recommend|final (decision|outcome)|submit the (final|decision)/i],
  ['information.request', /\brequest|ask (the )?(customer|applicant)|missing (evidence|document|information)|obtain/i],
  ['specialist.refer', /\brefer|escalat|specialist|route .{0,30}(case|issue)/i],
  ['finding.resolve', /resolve (the )?finding|close (the )?finding|clear (the )?finding/i],
  ['finding.write', /\bfinding|discrepan|record (the |a |any )?(issue|problem|mismatch|concern)/i],
  ['specialist.read', /specialist.?s? (answer|reply|response|decision)/i],
  ['information.read', /(customer|applicant).?s? (reply|response|answer)/i],
  ['operation.read', /result of (the |a )?(pending )?operation/i],
  ['operation.lookup', /pending operation|\boperation/i],
  ['policy.read', /\bpolic(y|ies)|\brule\b/i],
  ['search.read', /search result/i],
  ['search', /\bsearch|look ?up/i],
  ['parties.list', /\bparties|list (the |all |each )?(applicants|parties|signers)|each party/i],
  ['documents.list', /\bdocuments?\b|evidence|statement|upload/i],
  ['application.read', /retriev|\bparse|case record|the application|intake|assigned application/i],
];
const signalOf = (id: string) => SIGNALS.find(([t]) => t === id)?.[1];

/** The tool a sentence is most likely about, among the offered tools (null when none is clear). */
export function toolForText(text: string, offered: readonly string[] | null): string | null {
  for (const [tool, re] of SIGNALS) if ((!offered || offered.includes(tool)) && re.test(text)) return tool;
  return null;
}

/** Tools named by a consequence clause ("record the finding and refer the case"), in the order written. */
export function toolsInClause(text: string, offered: readonly string[] | null): string[] {
  const hits: { tool: string; at: number }[] = [];
  for (const [tool, re] of SIGNALS) {
    if (offered && !offered.includes(tool)) continue;
    const m = new RegExp(re.source, 'i').exec(text);
    if (m && !hits.some((h) => h.tool === tool)) hits.push({ tool, at: m.index });
  }
  // Prefer the action tools; a bare "policy" in "according to policy" is not a step of its own.
  return hits
    .filter((h) => !(h.tool === 'policy.read' && hits.some((x) => x.tool !== 'policy.read')))
    .sort((a, b) => a.at - b.at)
    .map((h) => h.tool);
}

export type StepToolWarningCode = 'TOOL_PURPOSE_MISMATCH' | 'CONDITIONAL_TOOL_AS_MAIN' | 'FOLLOW_UP_WITHOUT_CONDITION' | 'FOLLOW_UP_TOOL_NOT_OFFERED' | 'NO_FINAL_RECOMMEND';
export interface StepToolWarning {
  /** 0-based step index. */
  step: number;
  code: StepToolWarningCode;
  message: string;
  /** The tool the step's words point to, when the warning suggests one. */
  suggest?: string;
}

const isConditionalText = (s: string) => /^\s*(if|when|where|unless|should|in case)\b/i.test(s);

/**
 * Warnings (never blocking) on a procedure: a step's words do not fit its tool's purpose, finding.write or
 * specialist.refer as a step's main tool without a condition, a follow-up without a condition that is not a chain,
 * a follow-up tool the template does not offer, and no final recommendation.
 */
export function stepToolWarnings(steps: unknown, offered: readonly string[] | null): StepToolWarning[] {
  const list = Array.isArray(steps) ? steps : [];
  const out: StepToolWarning[] = [];
  const n = (i: number) => `Step ${i + 1}`;
  list.forEach((raw, i) => {
    if (!isObj(raw)) return;
    const action = typeof raw.action === 'string' ? raw.action : '';
    const tool = typeof raw.tool === 'string' ? raw.tool.trim() : '';
    if (tool && action.trim()) {
      const own = signalOf(tool);
      const best = toolForText(action, offered);
      if (best && best !== tool && !(own && own.test(action)) && !(TOOL_CHAINS[tool]?.includes(best))) {
        out.push({ step: i, code: 'TOOL_PURPOSE_MISMATCH', suggest: best, message: `${n(i)} says “${action.trim().slice(0, 60)}” but its tool is ${tool} (${TOOL_PURPOSE[tool] ?? 'not in the tool guide'}). Did you mean ${best} (${TOOL_PURPOSE[best]})?` });
      }
    }
    if (CONDITIONAL_TOOLS.includes(tool) && !isConditionalText(action)) {
      out.push({ step: i, code: 'CONDITIONAL_TOOL_AS_MAIN', message: `${n(i)} uses ${tool} as its main tool with no condition. ${tool === 'specialist.refer' ? 'Refer only when a check leaves an unresolved issue' : 'Record a finding only when a check finds a discrepancy'}: add it as a conditional follow-up (“If …”) on the check’s step, or start this step with “If …”.` });
    }
    for (const f of followUpsOf(raw)) {
      const chain = tool ? (TOOL_CHAINS[tool] ?? []) : [];
      if (!f.if && !f.tools.every((t) => chain.includes(t))) out.push({ step: i, code: 'FOLLOW_UP_WITHOUT_CONDITION', message: `${n(i)} has a follow-up (${f.tools.join(' → ')}) with no condition. Say when it applies, for example “If either applicant has an unresolved match”.` });
      const missing = offered ? f.tools.filter((t) => !offered.includes(t)) : [];
      if (missing.length) out.push({ step: i, code: 'FOLLOW_UP_TOOL_NOT_OFFERED', message: `${n(i)} has a follow-up tool this template does not offer: ${missing.join(', ')}.` });
    }
  });
  const last = [...list].reverse().find(isObj);
  if (list.length && (!offered || offered.includes('recommend')) && !(isObj(last) && last.tool === 'recommend')) {
    out.push({ step: list.length - 1, code: 'NO_FINAL_RECOMMEND', message: 'The procedure does not end with the final recommendation. Add a last step with recommend (Submit the final onboarding recommendation).' });
  }
  return out;
}

/** Shapes a step for storage: text fields kept, the tool blanked when not offered, follow-ups cleaned (and dropped when empty). */
export function cleanStep(step: ProcedureStep, offered: readonly string[] | null): ProcedureStep {
  const ok = (t: string) => !offered || offered.includes(t);
  const tool = step.tool && ok(step.tool) ? step.tool : '';
  const followUps = followUpsOf(step)
    .map((f) => ({ ...f, tools: f.tools.filter(ok) }))
    .filter((f) => f.tools.length);
  return { action: step.action.trim(), tool, ...(step.failureBehaviour ? { failureBehaviour: step.failureBehaviour } : {}), ...(followUps.length ? { followUps } : {}) };
}

const sentencesOf = (text: string) =>
  text
    .split(/\n+|(?<=[.;!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

/**
 * The deterministic translation (also the mock drafter): each sentence becomes a step with the tool its words point to;
 * a sentence starting "If …, …" becomes a conditional follow-up on the step before it; documents.list gets its chain;
 * the procedure ends with recommend. The SME reviews and edits the result; nothing is saved until they apply it.
 */
export function translateProcedure(text: string, offered: readonly string[] | null): ProcedureStep[] {
  const steps: ProcedureStep[] = [];
  for (const s of sentencesOf(text)) {
    const cond = /^(?:if|when|where|should|in case)\s+(.+?),\s*(?:then\s+)?(.+)$/i.exec(s);
    if (cond) {
      const tools = toolsInClause(cond[2]!, offered).filter((t) => t !== 'recommend');
      const followUp = { if: cond[1]!.trim(), tools };
      if (steps.length && tools.length) {
        const prev = steps[steps.length - 1]!;
        prev.followUps = [...(prev.followUps ?? []), followUp];
      } else steps.push({ action: s, tool: '', ...(tools.length ? { followUps: [followUp] } : {}) });
      continue;
    }
    const tool = toolForText(s, offered) ?? '';
    const chain = tool ? (TOOL_CHAINS[tool] ?? []).filter((t) => !offered || offered.includes(t)) : [];
    steps.push({ action: s, tool, ...(chain.length ? { followUps: [{ tools: [...chain] }] } : {}) });
  }
  if ((!offered || offered.includes('recommend')) && steps.length && !steps.some((x) => x.tool === 'recommend'))
    steps.push({ action: 'Submit the final onboarding recommendation with the evidence.', tool: 'recommend' });
  return steps.map((x) => cleanStep(x, offered));
}
