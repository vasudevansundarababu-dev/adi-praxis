import { applyGraphOps, graphOpText, planNextQuestion, profileForTemplate, WorkflowGraph, type ConversationProposal } from '@praxis/shared';
export { AUTHORSHIP_VERSION, AUTHORSHIP_TERMS } from '@praxis/shared';
const normal = (v: string) => v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** Reject new substantive text not extractable from AUTHOR messages. This proves source linkage, not external authorship. */
export function authoredChangeProblems(current: Record<string, unknown>, p: ConversationProposal, authorMessages: string[]): string[] {
  const sources = authorMessages.map(normal), issues: string[] = [];
  const keys=new Set('title difficulty jurisdiction language estimatedSteps coverageTags edgeCase trigger customerType product channel businessContext parties ownership statedPurpose expectedActivity id role kind name dateOfBirth incorporationDate nationality incorporationCountry addresses identifiers type value ownerId ownedId percent documents issuer partyId issueDate expiryDate fields defects tools responses tool input arguments response action responseId expectedResult why dependsOn steps findings description evidenceRefs severity disposition riskRating riskFactors requestsToCustomer rationale humanHandoff criteria weight passCondition critical commonErrors caughtBy acceptableVariations'.split(' '));
  const walk = (value: unknown, prior: unknown, path: string) => {
    if (JSON.stringify(value) === JSON.stringify(prior)) return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, Array.isArray(prior) ? prior[i] : undefined, `${path}.${i}`)); return; }
    if (value && typeof value === 'object') { for (const [k,v] of Object.entries(value)) { if(!keys.has(k) && !path.includes('coverageTags') && !path.includes('arguments')) {issues.push('Unsupported structured field; use the template-defined fields.'); continue;} if(!/^[A-Za-z_][A-Za-z0-9_]{0,59}$/.test(k)){issues.push('Invalid structured field name.');continue;} walk(v, prior && typeof prior === 'object' ? (prior as Record<string, unknown>)[k] : undefined, `${path}.${k}`); } return; }
    if (value === null || value === undefined || value === '') return;
    if (typeof value === 'string') {
      // Stable structural IDs do not supply substantive answers. Other labels and claims require SME words.
      if (/\.(id|responseId)$|\.(dependsOn|evidenceRefs)\.\d+$/.test(path) && /^[A-Za-z]+[-_]?\d{1,5}$/.test(value)) return;
      let added = value;
      if (typeof prior === 'string' && prior.length) {
        if (value.startsWith(prior)) added=value.slice(prior.length);
        else if (value.endsWith(prior)) added=value.slice(0,value.length-prior.length);
      }
      const needle=normal(added);
      if (needle && !sources.some(s=>s.includes(needle))) issues.push(`Type your own content for ${path}; generated or unsupported wording cannot be applied.`);
      return;
    }
    if (typeof value === 'number' && !authorMessages.some(s=>new RegExp(`(^|[^0-9])${String(value).replace('.', '\\.')}([^0-9]|$)`).test(s))) issues.push(`Supply the numeric value for ${path} yourself.`);
    if (typeof value === 'boolean' && !authorMessages.some(s=>normal(s).includes(normal(`${path.split('.').at(-1)} ${value}`)))) issues.push(`Explicitly state ${path.split('.').at(-1)} ${value} yourself.`);
  };
  for (const c of p.changes) walk(c.value,current[c.section],c.section);
  issues.push(...graphOpProblems(current, p, sources));
  return [...new Set(issues)].slice(0,20);
}
/** Public response text is server-owned: an off-topic or answer-generating model reply is never shown. */
export function facilitatorQuestion(text: string, output: Record<string, unknown>, template: string | { workflowName: string; profileId?: string | null }): string {
  const form = typeof template === 'string' ? { workflowName: template, profileId: null } : template;
  const workflow = form.workflowName;
  if (/\b(ssn|tax\s*id|tin)\b/i.test(text)) return 'Which jurisdiction and customer category apply, and which approved project rule requires this identifier or permits an alternative? State your own assessment.';
  // Template-aware planner (Wave 2): the next required field the SME has not written yet, from the template profile.
  const lookup = profileForTemplate(form);
  if (lookup.status === 'ok') {
    const planned = planNextQuestion(lookup.profile, output, text);
    if (planned) return planned.question;
  }
  if (/rubric|grading|weight|criterion/i.test(text)) return 'In your own words, what earns full, partial and zero credit, and which failure is critical?';
  if (/policy|rule|exception/i.test(text)) return 'Which published project rule applies to which investigation step, and what facts or exceptions determine its applicability?';
  if (!(output as {scenario?: unknown}).scenario) return `Describe one ${workflow} case in your own words: the subject, evidence and complication.`;
  return 'What evidence supports your assessment, what remains unresolved, and what would you recommend? Please write your own reasoning.';
}
export function generationRequest(text: string) {
  return /(?:write|generate|draft|create|give|produce|solve|answer).{0,50}(?:for me|my answer|the answer|correct answer|reference solution|complete task)|(?:do|finish)\s+(?:my|the)\s+(?:task|work)|write\s+(?:a|an)\s+(?:poem|essay|story)|\b(?:weather|sports scores|stock price)\b/i.test(text);
}

/**
 * Workflow changes a proposal carries (Wave 2): every label, instruction and prompt must come from the SME's own
 * messages, and the operations must apply to the current graph. Applying happens only on the SME's confirmation.
 */
function graphOpProblems(current: Record<string, unknown>, p: ConversationProposal, normalisedSources: string[]): string[] {
  if (!p.graphOps?.length) return [];
  const issues: string[] = [];
  p.graphOps.forEach((op, i) => {
    for (const text of graphOpText(op)) {
      const needle = normal(text);
      if (needle && !normalisedSources.some((s) => s.includes(needle))) issues.push(`Type your own wording for workflow change ${i + 1} ("${text.slice(0, 60)}"); generated wording cannot be applied.`);
    }
  });
  const graph = WorkflowGraph.safeParse(current.workflowGraph);
  if (!graph.success) issues.push('Start the workflow in Classic before changing it in the chat.');
  else {
    try {
      applyGraphOps(graph.data, p.graphOps);
    } catch (e) {
      issues.push(`Workflow change cannot apply: ${e instanceof Error ? e.message : 'invalid change'}.`);
    }
  }
  return issues;
}
