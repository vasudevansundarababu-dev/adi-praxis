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

/**
 * E-002 §4.1.6: per task revision, the clause identity the RL Gym's applicability resolver needs: clause ID and version,
 * source document hash, the approved condition, exceptions, the project approval and the template binding revision.
 * Only cited versions that carry a structured condition are listed, so packages without one keep their exact bytes
 * (old exports stay reproducible).
 */
export async function clausesFor(tx: Db | Tx, record: Pick<ApprovedTaskRecord, 'clientId' | 'projectId' | 'output'>, anvilSpec: unknown): Promise<Record<string, unknown>[]> {
  // Only Authoring's own citations (a rule UUID); anything else (older fixtures, free text) is not a clause reference.
  const cited = citedRules(record.output).filter((c) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.ruleId));
  if (!cited.length) return [];
  const bound = templateBoundFacts(anvilSpec);
  const out: Record<string, unknown>[] = [];
  for (const c of cited) {
    const v = await tx.policyRuleVersion.findFirst({ where: { ruleId: c.ruleId, contentHash: c.contentSha256, clientId: record.clientId }, include: { rule: true, citations: { take: 1, include: { documentVersion: true } } } });
    if (!v) continue;
    const body = PolicyRuleBody.parse(v.body);
    if (body.condition === undefined) continue;
    const src = v.citations[0];
    out.push({
      clause_id: v.rule.ruleKey,
      version: v.version,
      source: src ? { document_id: src.documentVersion.documentId, document_version: src.documentVersion.version, sha256: src.documentVersion.sha256, locator: src.locator } : null,
      condition: body.condition,
      exceptions: body.exceptions,
      approval: v.reviewedAt ? { approval_id: v.id, project_id: record.projectId, approved_by: v.reviewedById, approved_at: v.reviewedAt.toISOString() } : null,
      binding_revision: bound?.factCatalog || null,
    });
  }
  return out;
}
