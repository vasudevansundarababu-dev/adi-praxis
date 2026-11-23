import { PolicyRuleBody } from '@praxis/shared';
import type { ApprovedTaskRecord } from '@prisma/client';
import type { Db, Tx } from '../db';
import { templateBoundFacts } from '../policy/fact-catalog';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every S4 citation of the task ({ruleId, contentSha256}), whatever the S4 field is called. */
export function citedRules(output: unknown): { ruleId: string; contentSha256: string }[] {
  const s4 = isObj(output) && isObj(output.sections) && isObj(output.sections.S4) ? output.sections.S4 : {};
  const out: { ruleId: string; contentSha256: string }[] = [];
  for (const v of Object.values(s4))
    if (Array.isArray(v))
      for (const i of v) if (isObj(i) && typeof i.ruleId === 'string' && typeof i.contentSha256 === 'string' && !out.some((o) => o.ruleId === i.ruleId && o.contentSha256 === i.contentSha256)) out.push({ ruleId: i.ruleId, contentSha256: i.contentSha256 });
  return out;
}

/** One `policy_clauses` entry (approved-task-export.v1, Studio ef06119), and whether the PM set a structured condition. */
export interface PolicyClauseEntry {
  entry: Record<string, unknown>;
  hasCondition: boolean;
}

/**
 * E-002 §4.1.6: every approved clause version the task's S4 cites, pinned exactly as the PM approved it: clause ID and
 * version, source document (ID, version, sha256, locator, quote), approval (ID, project, by, at), the condition
 * (clause-condition.v1; null = applies across the approved scope), title, obligation and exceptions. Versions that were
 * never approved (no reviewedAt) or have no source are left out: the contract requires both.
 */
export async function policyClausesFor(tx: Db | Tx, record: Pick<ApprovedTaskRecord, 'clientId' | 'projectId' | 'output'> & { createdAt?: Date }): Promise<PolicyClauseEntry[]> {
  // Only Authoring's own citations (a rule UUID); anything else (older fixtures, free text) is not a clause reference.
  const cited = citedRules(record.output).filter((c) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.ruleId));
  const out: PolicyClauseEntry[] = [];
  for (const c of cited) {
    const v = await tx.policyRuleVersion.findFirst({ where: { ruleId: c.ruleId, contentHash: c.contentSha256, clientId: record.clientId }, include: { rule: true, citations: { take: 1, include: { documentVersion: true } } } });
    // Pinned per revision: only approvals that existed when this revision was approved, so the same revision always
    // exports the same policy_clauses (the selection itself is in the package's authored sections).
    if (!v || !v.reviewedAt || (record.createdAt && v.reviewedAt > record.createdAt)) continue;
    const src = v.citations[0];
    if (!src) continue;
    const body = PolicyRuleBody.parse(v.body);
    const loc = src.locator as { section?: string | null; page?: number | null } | null;
    const locator = loc ? [loc.section, loc.page ? `page ${loc.page}` : null].filter(Boolean).join(', ') : '';
    const exceptions = (body.exceptions.items ?? []).map((e: { statement?: string }) => e.statement).filter((t): t is string => !!t).map((text) => ({ text }));
    out.push({
      hasCondition: body.condition !== undefined,
      entry: {
        clause_id: v.rule.ruleKey,
        version: v.version,
        title: body.title,
        obligation: body.requirement,
        source: { document_id: src.documentVersion.documentId, document_version: src.documentVersion.version, sha256: src.documentVersion.sha256, ...(locator ? { locator } : {}), quote: src.quote },
        approval: { approval_id: v.id, project_id: record.projectId, ...(v.reviewedById ? { approved_by: v.reviewedById } : {}), approved_at: v.reviewedAt.toISOString() },
        condition: body.condition ?? null,
        ...(exceptions.length ? { exceptions } : {}),
      },
    });
  }
  return out;
}

/**
 * The package's private part: the same entries plus the template binding revision, only for clauses with a structured
 * condition, so packages without one keep their exact bytes (old exports stay reproducible).
 */
export async function clausesFor(tx: Db | Tx, record: Pick<ApprovedTaskRecord, 'clientId' | 'projectId' | 'output'> & { createdAt?: Date }, anvilSpec: unknown): Promise<Record<string, unknown>[]> {
  const bound = templateBoundFacts(anvilSpec);
  return (await policyClausesFor(tx, record)).filter((c) => c.hasCondition).map((c) => ({ ...c.entry, binding_revision: bound?.factCatalog || null }));
}
