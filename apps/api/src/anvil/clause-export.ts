import { PolicyRuleBody } from '@praxis/shared';
import type { ApprovedTaskRecord, Prisma } from '@prisma/client';
import type { Db, Tx } from '../db';
import { templateBoundFacts } from '../policy/fact-catalog';
import { textSha256 } from '../policy/text-hash';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const s4Items = (output: unknown): Record<string, unknown>[] => {
  const s4 = isObj(output) && isObj(output.sections) && isObj(output.sections.S4) ? output.sections.S4 : {};
  return Object.values(s4).flatMap((v) => (Array.isArray(v) ? v.filter(isObj) : []));
};
/**
 * A rule picker citation (`policy_citation`, KYC Judgment v1 A5): the rule key in `ruleId` and the exact published
 * version's id in `ruleVersion`, plus that version's `contentSha256` (citations picked before 25 Nov 2026 have none).
 */
const isPickerCitation = (i: Record<string, unknown>) => typeof i.ruleId === 'string' && !UUID.test(i.ruleId) && typeof i.ruleVersion === 'string' && UUID.test(i.ruleVersion);

/** Every S4 citation by id and hash ({ruleId, contentSha256}), whatever the S4 field is called. Rule picker citations are listed by `citedRuleVersions`. */
export function citedRules(output: unknown): { ruleId: string; contentSha256: string }[] {
  const out: { ruleId: string; contentSha256: string }[] = [];
  for (const i of s4Items(output)) if (!isPickerCitation(i) && typeof i.ruleId === 'string' && typeof i.contentSha256 === 'string' && !out.some((o) => o.ruleId === i.ruleId && o.contentSha256 === i.contentSha256)) out.push({ ruleId: i.ruleId, contentSha256: i.contentSha256 });
  return out;
}

/** Every S4 rule picker citation: the rule key, the exact version id and, when stored, that version's content hash. */
export function citedRuleVersions(output: unknown): { ruleKey: string; ruleVersionId: string; contentSha256: string | null }[] {
  const out: { ruleKey: string; ruleVersionId: string; contentSha256: string | null }[] = [];
  for (const i of s4Items(output))
    if (isPickerCitation(i) && !out.some((o) => o.ruleVersionId === i.ruleVersion)) out.push({ ruleKey: i.ruleId as string, ruleVersionId: i.ruleVersion as string, contentSha256: typeof i.contentSha256 === 'string' ? i.contentSha256 : null });
  return out;
}

/**
 * Every S4 citation by C1's rule identity (KYC Judgment v1 C4 `expectedRules`): the rule key, Authoring's integer version
 * and the text SHA-256.
 */
export function citedRuleIdentities(output: unknown): { ruleKey: string; version: number; textSha256: string }[] {
  const out: { ruleKey: string; version: number; textSha256: string }[] = [];
  for (const i of s4Items(output))
    if (typeof i.ruleId === 'string' && !UUID.test(i.ruleId) && typeof i.ruleVersion === 'number' && Number.isInteger(i.ruleVersion) && typeof i.textSha256 === 'string' && !out.some((o) => o.ruleKey === i.ruleId && o.version === i.ruleVersion))
      out.push({ ruleKey: i.ruleId, version: i.ruleVersion, textSha256: i.textSha256 });
  return out;
}

const clauseInclude = { rule: true, citations: { take: 1, include: { documentVersion: true } } } as const;

/**
 * The clause version each S4 citation names, exactly: by rule id and content hash, or (rule picker) by version id, with
 * the stored hash matching when there is one. The clause id exported is always the library's rule key. A citation that names nothing exactly resolves to null; never guessed.
 */
export async function citedClauseVersions(tx: Db | Tx, clientId: string, output: unknown, projectId: string | null = null) {
  const out: { citation: string; version: Prisma.PolicyRuleVersionGetPayload<{ include: typeof clauseInclude }> | null }[] = [];
  // Only Authoring's own citations (a rule UUID); anything else (older fixtures, free text) is not a clause reference.
  for (const c of citedRules(output).filter((x) => UUID.test(x.ruleId)))
    out.push({ citation: c.ruleId, version: await tx.policyRuleVersion.findFirst({ where: { ruleId: c.ruleId, contentHash: c.contentSha256, clientId }, include: clauseInclude }) });
  for (const c of citedRuleVersions(output)) {
    const v = await tx.policyRuleVersion.findFirst({ where: { id: c.ruleVersionId, clientId }, include: clauseInclude });
    // The version id names one immutable published version; the stored hash, when present, must be that version's.
    const exact = v && (c.contentSha256 === null || c.contentSha256 === v.contentHash);
    out.push({ citation: c.ruleKey, version: exact ? v : null });
  }
  // C1 identity: the project's rule with that key, at that version, whose text hashes to the cited SHA-256.
  for (const c of citedRuleIdentities(output)) {
    const v = projectId ? await tx.policyRuleVersion.findFirst({ where: { clientId, version: c.version, rule: { projectId, ruleKey: c.ruleKey } }, include: clauseInclude }) : null;
    const exact = v && textSha256(PolicyRuleBody.parse(v.body).requirement) === c.textSha256;
    out.push({ citation: c.ruleKey, version: exact ? v : null });
  }
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
  const out: PolicyClauseEntry[] = [];
  for (const { version: v } of await citedClauseVersions(tx, record.clientId, record.output, record.projectId)) {
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
        // C1 identity (approved-task-export.v1 policy_clauses, additive): the SHA-256 of the served text.
        text_sha256: textSha256(body.requirement),
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
