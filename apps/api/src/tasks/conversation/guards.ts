import { applyConversationChanges, ConversationProposal, kycChecks, type KycTask } from '@praxis/shared';
import { detectSensitive } from '../../candidate/sensitive';
export function proposalProblems(current: Record<string, unknown>, p: ConversationProposal, rules: Array<{ rule_version_id: string; visibility: string }>, kyc: boolean): string[] {
  const issues: string[] = [];
  let next: Record<string, unknown>;
  try { next = applyConversationChanges(current, p); } catch (e) { return [String(e)]; }
  const data = JSON.stringify(p);
  if (data.length > 120000) issues.push('Proposal exceeds storage limit');
  if (detectSensitive(data).flagged) issues.push('Potential real sensitive data in model output');
  const known = new Set(rules.map(r => r.rule_version_id));
  for (const link of p.ruleLinks) {
    if (!known.has(link.ruleVersionId)) issues.push('Unknown or unpublished policy rule');
    const steps = (next.solution as KycTask['solution'])?.steps ?? [];
    if (!steps.some(s => s.id === link.stepId)) issues.push('Policy link refers to an unknown step');
  }
  // Policy in the shared task is free text and cannot safely encode evaluator-only visibility.
  if (p.changes.some(c => c.section === 'policy')) issues.push('Project policy cannot be rewritten by chat; link published rules instead');
  if (current.praxisContract && p.changes.length) issues.push('Executable contract tasks require a dedicated adapter; existing contract is preserved');
  const before = current as KycTask, after = next as KycTask;
  if (kyc) {
    const prior = new Set(kycChecks(before, null).filter(c => !c.ok && c.severity !== 'warning').map(c => c.id));
    for (const check of kycChecks(after, null)) if (!check.ok && check.severity !== 'warning' && !prior.has(check.id)) issues.push(check.message);
  }
  const documents = after.evidence?.documents ?? [], responses = after.environment?.responses ?? [], steps = after.solution?.steps ?? [];
  const evidenceIds = new Set([...documents.map(d => d.id), ...responses.map(r => r.id)]);
  for (const f of after.solution?.findings ?? []) if ((f.evidenceRefs ?? []).some(id => !evidenceIds.has(id))) issues.push('Finding cites unknown evidence');
  const stepIds = new Set(steps.map(s => s.id));
  for (const step of steps) if ((step.dependsOn ?? []).some(id => !stepIds.has(id) || id === step.id)) issues.push('Step has invalid dependency');
  const criteria = after.rubric?.criteria;
  if (criteria?.length && (criteria.some(c => !Number.isFinite(c.weight) || c.weight < 0 || c.weight > 100) || criteria.reduce((n,c) => n+c.weight,0) !== 100)) issues.push('Rubric weights must total 100');
  const disposition = after.solution?.disposition;
  if (disposition && /^(APPROVE|REJECT|APPROVED|REJECTED)$/i.test(disposition)) issues.push('Autonomous final disposition violates human gate');
  // Prevent private rule text from being copied into changed executor-facing sections.
  const privateRules = rules.filter(r => r.visibility !== 'agent_visible');
  if (privateRules.length && p.changes.some(c => ['scenario', 'customerFile', 'evidence', 'body'].includes(c.section))) {
    issues.push('Executor-facing changes with private policy context require separate visibility review');
  }
  return [...new Set(issues)];
}

/** Narrow deterministic tripwires, not a comprehensive prompt-injection detector. */
export function conversationInputProblems(text: string): string[] {
  const issues: string[] = [];
  if (detectSensitive(text).flagged) issues.push('Use synthetic placeholders; possible sensitive information was detected.');
  if (/ignore\s+(?:all\s+|previous\s+)?(?:instructions|rules)|bypass\s+(?:the\s+)?(?:review|guardrails)|reveal\s+(?:the\s+)?(?:hidden|system)\s+(?:prompt|instructions)/i.test(text)) issues.push('Instruction-override request is not allowed in the authoring chat. Describe adversarial case evidence separately.');
  return issues;
}
