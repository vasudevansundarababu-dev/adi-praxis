import { z } from 'zod';
/** Model output is a proposal, never an approval or an executable tool call. */
const Json: z.ZodType<unknown> = z.lazy(() => z.union([z.string().max(12000), z.number().finite(), z.boolean(), z.null(), z.array(Json).max(100), z.record(Json)]));
export const AUTHORING_KEYS = ['header', 'scenario', 'customerFile', 'evidence', 'environment', 'policy', 'solution', 'rubric', 'body'] as const;
export const ConversationProposal = z.object({
  reply: z.string().min(1).max(4000),
  question: z.string().min(1).max(1200),
  changes: z.array(z.object({ section: z.enum(AUTHORING_KEYS), value: Json, reason: z.string().min(1).max(2000) }).strict()).max(9),
  ruleLinks: z.array(z.object({ stepId: z.string().max(100), ruleVersionId: z.string().max(100), reason: z.string().min(1).max(2000) }).strict()).max(50),
  unresolved: z.array(z.string().min(1).max(1000)).max(30),
}).strict();
export type ConversationProposal = z.infer<typeof ConversationProposal>;
export function applyConversationChanges(current: Record<string, unknown>, p: ConversationProposal) {
  const next = structuredClone(current);
  const seen = new Set<string>();
  for (const c of p.changes) {
    if (seen.has(c.section)) throw new Error('Duplicate section change');
    seen.add(c.section);
    const encoded = JSON.stringify(c.value);
    if (/"(?:__proto__|constructor|prototype)"\s*:/.test(encoded)) throw new Error('Unsafe object key');
    if (c.value === null || (c.section !== 'body' && (typeof c.value !== 'object' || Array.isArray(c.value)))) throw new Error('Sections must be objects');
    if (c.section === 'body' && typeof c.value !== 'string') throw new Error('Body must be text');
    next[c.section] = structuredClone(c.value);
  }
  return next;
}
/** An allowlisted projection. Private expected outcomes, defects and grading never enter the executor preview. */
export function authoringAgentView(task: Record<string, unknown>) {
  const t = task as { header?: { title?: string; jurisdiction?: string; language?: string }; scenario?: Record<string, unknown>; customerFile?: Record<string, unknown>; evidence?: { documents?: Array<Record<string, unknown>> }; environment?: { tools?: string[] }; policy?: { rules?: unknown[] } };
  return { title: t.header?.title, jurisdiction: t.header?.jurisdiction, language: t.header?.language,
    scenario: t.scenario ? Object.fromEntries(['trigger','customerType','product','channel','businessContext'].filter(k => k in t.scenario!).map(k => [k,t.scenario![k]])) : undefined, customerFile: t.customerFile ? Object.fromEntries(['parties','ownership','statedPurpose','expectedActivity'].filter(k => k in t.customerFile!).map(k => [k,t.customerFile![k]])) : undefined,
    documents: t.evidence?.documents?.map(({ id, type, issuer, partyId, issueDate, expiryDate, fields }) => ({ id, type, issuer, partyId, issueDate, expiryDate, fields })),
    tools: t.environment?.tools ?? [] };
}

export const AUTHORSHIP_VERSION = 'human-only/1';
export const AUTHORSHIP_TERMS = 'I will author the task, findings, reference solution, rationale and rubric myself. I will not use the built-in assistant or an external LLM to generate answers. Case data must be synthetic and sources authorised. The assistant may ask task-scoped questions, identify gaps and organise my words. Similarity and browser activity signals may be reviewed by a human; they are not proof of misconduct. I may explain or dispute a flag.';
