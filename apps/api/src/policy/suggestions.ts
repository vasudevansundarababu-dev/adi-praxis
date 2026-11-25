import { ClauseCondition, PolicyRuleBody, RuleLibraryMeta } from '@praxis/shared';
import type { Prisma } from '@prisma/client';
import type { Db, Tx } from '../db';

/**
 * KYC Judgment v1 A1/A2 (owner, 25 Nov 2026): AI suggestions for one exact rule version, stored with the server's checks.
 * A suggestion never changes a rule by itself: a PM adopts it as an ordinary, audited rule edit.
 */
export interface SuggestionInput {
  clientId: string;
  projectId: string;
  ruleId: string;
  ruleVersionId: string;
  contentHash: string;
  source: 'disposition' | 'enrichment';
  model: string;
  promptVersion: string;
  content: Record<string, unknown>;
  problems: string[];
  createdById: string;
}

/** Stores a suggestion once per (rule version, content hash, source, prompt, model); a repeat returns the stored one. */
export async function storeSuggestion(tx: Db | Tx, s: SuggestionInput) {
  const key = { ruleVersionId: s.ruleVersionId, contentHash: s.contentHash, source: s.source, promptVersion: s.promptVersion, model: s.model };
  const existing = await tx.policyRuleSuggestion.findFirst({ where: key });
  if (existing) return existing;
  // JSON round trip: drops undefined values, so the stored content is exactly what JSON can say.
  const content = JSON.parse(JSON.stringify(s.content)) as Prisma.InputJsonValue;
  return tx.policyRuleSuggestion.create({ data: { ...key, clientId: s.clientId, projectId: s.projectId, ruleId: s.ruleId, content, problems: s.problems, createdById: s.createdById } });
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The rule body with a suggestion's adoptable parts applied, and which parts those are: the condition (a recommended
 * disposition, or an enrichment's condition) and the library metadata (merged into the body's, part by part). A
 * question or an out-of-scope disposition has nothing to adopt.
 */
export function adoptedBody(body: PolicyRuleBody, content: unknown): { body: PolicyRuleBody; parts: string[] } {
  const c = isObj(content) ? content : {};
  const parts: string[] = [];
  let next: PolicyRuleBody = body;
  const disposition = typeof c.disposition === 'string' ? c.disposition : null;
  if ('condition' in c && (disposition === null || disposition === 'recommended')) {
    const cond = ClauseCondition.safeParse(c.condition ?? null);
    if (cond.success) {
      next = { ...next, condition: cond.data };
      parts.push('condition');
    }
  }
  if (isObj(c.library)) {
    const merged = RuleLibraryMeta.safeParse({ ...(next.library ?? {}), ...c.library });
    if (merged.success) {
      next = { ...next, library: merged.data };
      parts.push(...Object.keys(c.library).map((k) => `library.${k}`));
    }
  }
  return { body: next, parts };
}
