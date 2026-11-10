import type { Prisma, PolicyDocumentVersion } from '@prisma/client';
import { PolicyRuleBody, type CandidateCitation, type CandidateRule } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError, conflict, notFound } from '../lib/errors';
import type { AuditInput } from '../platform/audit';
import { needsDefinition, resolveCitation } from './extraction/normalise';

export const contentHash = (body: PolicyRuleBody, citations: Array<{ documentVersionId: string; fieldPath: string; quote: string }>) =>
  sha256(stableStringify({ body, citations: citations.map((c) => [c.documentVersionId, c.fieldPath, c.quote]).sort() }));

const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'RULE';

async function uniqueKey(tx: Tx, projectId: string, wanted: string) {
  const base = wanted.startsWith('R-') ? wanted : `R-${wanted}`;
  let key = base;
  for (let i = 2; await tx.policyRule.findUnique({ where: { projectId_ruleKey: { projectId, ruleKey: key } } }); i++) key = `${base}-${i}`;
  return key;
}

/**
 * Stores one extracted or manual candidate as a new rule with a first version in DRAFT or NEEDS_DEFINITION (never
 * Reviewed). Citations are resolved against the exact document version; unresolved quotes keep the rule in Needs
 * definition (S1 R02, S2 §9).
 */
export async function createRuleFromCandidate(
  tx: Tx,
  input: { clientId: string; projectId: string; documentVersion: PolicyDocumentVersion; doc: { text: string; pages: string[]; format: string }; candidate: CandidateRule; origin: string; editedById: string; extractionJobId?: string | null; ruleKey?: string | null; state?: 'DRAFT' | 'NEEDS_DEFINITION' },
) {
  const { citations: raw, ruleKey: proposedKey, ...rest } = input.candidate;
  const body = PolicyRuleBody.parse(rest);
  const resolved = raw.map((c: CandidateCitation) => ({ c, r: resolveCitation(c, input.doc) }));
  const key = await uniqueKey(tx, input.projectId, input.ruleKey ?? proposedKey ?? slug(body.title));
  const rule = await tx.policyRule.create({ data: { clientId: input.clientId, projectId: input.projectId, ruleKey: key, sourceKey: (input.ruleKey ?? proposedKey)?.trim() || null } });
  const citations = resolved.map(({ c, r }) => ({ documentVersionId: input.documentVersion.id, fieldPath: c.fieldPath, quote: r.quote }));
  const unresolved = resolved.length === 0 || !resolved.some(({ c, r }) => c.fieldPath === 'requirement' && r.resolution === 'RESOLVED');
  const state = input.state ?? (needsDefinition(input.candidate) || unresolved ? 'NEEDS_DEFINITION' : 'DRAFT');
  const version = await tx.policyRuleVersion.create({
    data: { clientId: input.clientId, ruleId: rule.id, version: 1, state, body: body as unknown as Prisma.InputJsonValue, contentHash: contentHash(body, citations), extractionJobId: input.extractionJobId ?? null, origin: input.origin, editedById: input.editedById },
  });
  for (const { c, r } of resolved) {
    await tx.policyCitation.create({
      data: { clientId: input.clientId, ruleVersionId: version.id, documentVersionId: input.documentVersion.id, fieldPath: c.fieldPath, role: c.role, quote: r.quote, locator: r.locator as unknown as Prisma.InputJsonValue, resolution: r.resolution, providerRaw: { page: c.page, chunkId: c.chunkId, lineStart: c.lineStart, lineEnd: c.lineEnd, confidence: c.confidence } as Prisma.InputJsonValue },
    });
  }
  return { rule, version };
}

export async function ruleVersionFull(tx: Db | Tx, clientId: string, id: string) {
  const v = await tx.policyRuleVersion.findFirst({ where: { id, clientId }, include: { rule: true, citations: { include: { documentVersion: { include: { document: true } } } } } });
  if (!v) throw notFound('Rule version not found');
  return v;
}

/** The current version of each rule in a project: the latest version (draft, needs definition, reviewed or excluded). */
export async function currentVersions(tx: Db | Tx, clientId: string, projectId: string) {
  const rules = await tx.policyRule.findMany({ where: { clientId, projectId }, orderBy: { ruleKey: 'asc' }, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { citations: { include: { documentVersion: { include: { document: true } } } } } } } });
  return rules.filter((r) => r.versions[0]).map((r) => ({ rule: r, version: r.versions[0]! }));
}

export interface CitationEdit {
  documentVersionId: string;
  fieldPath: string;
  role: 'supports' | 'qualifies' | 'exception' | 'conflict';
  quote: string;
  section?: string | null;
}

/**
 * Edits a rule (S1 R03–R09). A DRAFT/NEEDS_DEFINITION version is edited in place; a REVIEWED or EXCLUDED version is
 * never changed: a new draft version is created. Stale edits (expectedContentHash mismatch) are rejected (409).
 */
export async function editRule(
  tx: Tx,
  deps: { loadText: (v: PolicyDocumentVersion) => Promise<{ text: string; pages: string[] }> },
  input: { clientId: string; projectId: string; ruleId: string; actorId: string; expectedContentHash: string; body: PolicyRuleBody; citations?: CitationEdit[] },
  audit: (a: AuditInput) => Promise<void>,
) {
  const rule = await tx.policyRule.findFirst({ where: { id: input.ruleId, clientId: input.clientId, projectId: input.projectId }, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { citations: true } } } });
  if (!rule?.versions[0]) throw notFound('Rule not found');
  await tx.$queryRaw`SELECT id FROM "PolicyRule" WHERE id = ${rule.id}::uuid FOR UPDATE`;
  const cur = rule.versions[0];
  if (cur.contentHash !== input.expectedContentHash) throw conflict('This rule changed since you opened it. Reload to see the latest version.');
  const body = PolicyRuleBody.parse(input.body);

  const citationInputs = input.citations ?? cur.citations.map((c) => ({ documentVersionId: c.documentVersionId, fieldPath: c.fieldPath, role: c.role as CitationEdit['role'], quote: c.quote, section: (c.locator as { section?: string | null })?.section ?? null }));
  const resolved = [];
  for (const c of citationInputs) {
    const dv = await tx.policyDocumentVersion.findFirst({ where: { id: c.documentVersionId, projectId: input.projectId, clientId: input.clientId } });
    if (!dv) throw new AppError(400, 'BAD_CITATION', 'A citation points to a document version outside this project.');
    const r = resolveCitation({ fieldPath: c.fieldPath, role: c.role, quote: c.quote, page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: null }, { ...(await deps.loadText(dv)), format: dv.format });
    if (c.section) r.locator.section = c.section;
    resolved.push({ c, r });
  }
  const hash = contentHash(body, resolved.map(({ c, r }) => ({ documentVersionId: c.documentVersionId, fieldPath: c.fieldPath, quote: r.quote })));
  if (hash === cur.contentHash) return cur;

  let version;
  if (cur.state === 'REVIEWED' || cur.state === 'EXCLUDED') {
    version = await tx.policyRuleVersion.create({ data: { clientId: input.clientId, ruleId: rule.id, version: cur.version + 1, state: 'DRAFT', body: body as unknown as Prisma.InputJsonValue, contentHash: hash, origin: 'edit', editedById: input.actorId } });
    await tx.policyRule.update({ where: { id: rule.id }, data: { latestVersion: cur.version + 1 } });
  } else {
    await tx.policyCitation.deleteMany({ where: { ruleVersionId: cur.id } });
    version = await tx.policyRuleVersion.update({ where: { id: cur.id }, data: { body: body as unknown as Prisma.InputJsonValue, contentHash: hash, editedById: input.actorId, state: 'DRAFT' } });
  }
  for (const { c, r } of resolved) {
    await tx.policyCitation.create({ data: { clientId: input.clientId, ruleVersionId: version.id, documentVersionId: c.documentVersionId, fieldPath: c.fieldPath, role: c.role, quote: r.quote, locator: r.locator as unknown as Prisma.InputJsonValue, resolution: r.resolution, confirmedById: input.actorId } });
  }
  await audit({ entityType: 'PolicyRuleVersion', entityId: version.id, action: 'policy.rule_edited', before: { contentHash: cur.contentHash, version: cur.version, state: cur.state }, after: { contentHash: hash, version: version.version } });
  return version;
}

/** Reasons a version cannot be marked Reviewed yet (S1 R10, PRD PR-R02/R04). Empty = reviewable. */
export function reviewProblems(v: { body: unknown; citations: Array<{ fieldPath: string; resolution: string }> }): string[] {
  const b = PolicyRuleBody.parse(v.body);
  const p: string[] = [];
  const a = b.applicability;
  if (!b.requirement.trim()) p.push('Add the requirement.');
  if (b.requirementType === 'unknown') p.push('Choose whether this is an obligation, prohibition, permission or definition.');
  if (!a.universal && a.actors.length + a.actions.length + a.channels.length + a.entities.length + a.locales.length + a.jurisdictions.length === 0 && !a.conditionText) p.push('Define where the rule applies, or mark it as applying everywhere.');
  if (!b.effective.from && !b.effective.to && !b.effective.conditionText) p.push('Set the effective scope (a date, or "always" in the condition).');
  const ok = (path: string) => v.citations.some((c) => c.resolution === 'RESOLVED' && (c.fieldPath === path || c.fieldPath.startsWith(`${path}.`)));
  if (!ok('requirement')) p.push('Link the requirement to a quote found in the source document.');
  if (a.conditionText && !ok('applicability')) p.push('Link the applicability condition to a source quote.');
  if (b.exceptions.kind === 'listed' && !ok('exceptions')) p.push('Link the listed exceptions to a source quote.');
  return p;
}

/** Marks the current version Reviewed (PM/ADMIN; D-R1: the editor may review). Stale decisions are rejected. */
export async function markReviewed(tx: Tx, input: { clientId: string; projectId: string; ruleVersionId: string; actorId: string; expectedContentHash: string; required?: boolean }, audit: (a: AuditInput) => Promise<void>) {
  const v = await ruleVersionFull(tx, input.clientId, input.ruleVersionId);
  if (v.rule.projectId !== input.projectId) throw notFound('Rule version not found');
  await tx.$queryRaw`SELECT id FROM "PolicyRuleVersion" WHERE id = ${v.id}::uuid FOR UPDATE`;
  if (v.contentHash !== input.expectedContentHash) throw conflict('This rule changed since you opened it. Reload and review the latest content.');
  if (v.state === 'REVIEWED') return v;
  if (v.state === 'EXCLUDED') throw conflict('An excluded rule cannot be reviewed. Edit it to create a new draft first.');
  const latest = await tx.policyRuleVersion.findFirst({ where: { ruleId: v.ruleId }, orderBy: { version: 'desc' }, select: { id: true } });
  if (latest?.id !== v.id) throw conflict('A newer version of this rule exists. Review the latest version.');
  const problems = reviewProblems(v);
  if (problems.length) throw new AppError(422, 'NOT_REVIEWABLE', `This rule is not ready to review: ${problems.join(' ')}`);
  const out = await tx.policyRuleVersion.update({ where: { id: v.id }, data: { state: 'REVIEWED', reviewedById: input.actorId, reviewedAt: new Date() } });
  if (input.required !== undefined) await tx.policyRule.update({ where: { id: v.ruleId }, data: { required: input.required } });
  await audit({ entityType: 'PolicyRuleVersion', entityId: v.id, action: 'policy.rule_reviewed', after: { contentHash: v.contentHash, version: v.version, ruleKey: v.rule.ruleKey } });
  return out;
}

export async function markExcluded(tx: Tx, input: { clientId: string; projectId: string; ruleVersionId: string; actorId: string; expectedContentHash: string; reason: string }, audit: (a: AuditInput) => Promise<void>) {
  const v = await ruleVersionFull(tx, input.clientId, input.ruleVersionId);
  if (v.rule.projectId !== input.projectId) throw notFound('Rule version not found');
  if (v.contentHash !== input.expectedContentHash) throw conflict('This rule changed since you opened it. Reload first.');
  if (v.state === 'REVIEWED') throw conflict('A reviewed rule cannot be excluded directly. Edit it to create a new draft, then exclude that.');
  if (v.state === 'EXCLUDED') return v;
  if (!input.reason.trim()) throw new AppError(422, 'REASON_REQUIRED', 'Give a reason for excluding this rule.');
  const out = await tx.policyRuleVersion.update({ where: { id: v.id }, data: { state: 'EXCLUDED', excludeReason: input.reason.trim(), reviewedById: input.actorId, reviewedAt: new Date() } });
  await audit({ entityType: 'PolicyRuleVersion', entityId: v.id, action: 'policy.rule_excluded', after: { reason: input.reason.trim(), ruleKey: v.rule.ruleKey } });
  return out;
}
