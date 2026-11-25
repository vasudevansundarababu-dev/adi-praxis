import { createHash } from 'node:crypto';
import { CandidateCitation, PolicyRuleBody, ProjectRuleSetContent } from '@praxis/shared';
import type { PolicyDocument, PolicyDocumentVersion, Prisma } from '@prisma/client';
import type { ObjectStorage } from '../candidate/storage';
import { stubScanner } from '../candidate/storage';
import type { Db, Tx } from '../db';
import { writeAudit, type AuditInput } from '../platform/audit';
import { addDocumentVersion, loadVersionText } from '../policy/documents';
import { resolveCitation } from '../policy/extraction/normalise';
import { latestRuleSet } from '../policy/rule-sets';
import { contentHash as ruleContentHash, createRuleFromCandidate } from '../policy/rules';

/**
 * `run.ts library-copy --from <projectId> --to <projectId> --requested-by <admin email> [--apply]` (KYC Judgment v1,
 * coordinator 25 Nov 2026; precedent: the v8 successor job, docs/DECISIONS.md D-076). Copies the source project's
 * published rule set into another project of the same client:
 * - every document version its rules cite, byte for byte (the SHA-256 is checked);
 * - every rule as a DRAFT, with the same key, body and quotes, re-linked to the copied document.
 * No approval is carried across: rules are per project, and the PM reviews them again in the new project (adding the
 * conditions and library details C1 needs). Dry run by default; audited as SYSTEM with the requesting Admin;
 * idempotent (a document already there by SHA-256, or a rule already there by key, is skipped). The source project is
 * never changed.
 */
const ACTOR = 'library-copy';
type Outcome = 'would_copy' | 'copied' | 'already_copied';
export interface LibraryCopyReport {
  outcome: 'refused' | Outcome;
  reason?: string;
  ruleSetVersion?: number;
  documents?: { title: string; sha256: string; outcome: Outcome }[];
  rules?: { ruleKey: string; outcome: Outcome }[];
}

export function parseLibraryCopyArgs(argv: string[]) {
  const a = { fromProjectId: '', toProjectId: '', requestedBy: '', apply: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (k === '--apply') a.apply = true;
    else if (k === '--from' && argv[i + 1]) a.fromProjectId = argv[++i]!;
    else if (k === '--to' && argv[i + 1]) a.toProjectId = argv[++i]!;
    else if (k === '--requested-by' && argv[i + 1]) a.requestedBy = argv[++i]!;
    else throw new Error(`Unknown library-copy argument "${k}". Use: --from <projectId> --to <projectId> --requested-by <admin email> [--apply]`);
  }
  if (!a.fromProjectId || !a.toProjectId || !a.requestedBy) throw new Error('library-copy needs --from, --to and --requested-by');
  return a;
}

const metaOf = (d: PolicyDocument) => ({ title: d.title, category: d.category, language: d.language, jurisdiction: d.jurisdiction, effectiveFrom: d.effectiveFrom?.toISOString().slice(0, 10) ?? null, effectiveTo: d.effectiveTo?.toISOString().slice(0, 10) ?? null });

export async function copyLibrary(db: Db, deps: { storage: ObjectStorage }, args: { fromProjectId: string; toProjectId: string; requestedBy: string; apply: boolean }): Promise<LibraryCopyReport> {
  return db.$transaction(
    async (tx) => {
      const refuse = (reason: string): LibraryCopyReport => ({ outcome: 'refused', reason });
      if (args.fromProjectId === args.toProjectId) return refuse('The source and target are the same project.');
      const src = await tx.project.findUnique({ where: { id: args.fromProjectId } });
      const dst = await tx.project.findUnique({ where: { id: args.toProjectId } });
      if (!src || !dst) return refuse('Project not found.');
      if (src.clientId !== dst.clientId) return refuse('Both projects must belong to the same client.');
      const admin = await tx.user.findFirst({ where: { clientId: src.clientId, email: { equals: args.requestedBy, mode: 'insensitive' }, status: 'ACTIVE', roles: { has: 'ADMIN' } } });
      if (!admin) return refuse('The requester must be an active Admin of this client.');
      const set = await latestRuleSet(tx, src.clientId, src.id);
      if (!set) return refuse('The source project has no published rule set to copy.');
      const content = ProjectRuleSetContent.parse(set.content);
      const dvIds = [...new Set(content.rules.flatMap((r) => r.sources.map((s) => s.documentVersionId)))];
      const dvs = await tx.policyDocumentVersion.findMany({ where: { id: { in: dvIds }, projectId: src.id }, include: { document: true }, orderBy: { createdAt: 'asc' } });

      const report: LibraryCopyReport = { outcome: 'would_copy', ruleSetVersion: set.version, documents: [], rules: [] };
      const mapped = new Map<string, PolicyDocumentVersion>();
      for (const dv of dvs) {
        const there = await tx.policyDocumentVersion.findFirst({ where: { projectId: dst.id, sha256: dv.sha256 } });
        if (there) mapped.set(dv.id, there);
        report.documents!.push({ title: dv.document.title, sha256: dv.sha256, outcome: there ? 'already_copied' : args.apply ? 'copied' : 'would_copy' });
      }
      const rules = [...content.rules].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
      const existing = new Set((await tx.policyRule.findMany({ where: { projectId: dst.id }, select: { ruleKey: true } })).map((r) => r.ruleKey));
      for (const r of rules) report.rules!.push({ ruleKey: r.ruleKey, outcome: existing.has(r.ruleKey) ? 'already_copied' : args.apply ? 'copied' : 'would_copy' });
      const nothing = report.documents!.every((d) => d.outcome === 'already_copied') && report.rules!.every((r) => r.outcome === 'already_copied');
      if (nothing) return { ...report, outcome: 'already_copied' };
      if (!args.apply) return report;

      const audit = (a: AuditInput) => writeAudit(tx, { clientId: src.clientId, actorType: 'SYSTEM', actorId: ACTOR }, a);
      const deps2 = { storage: deps.storage, scanner: stubScanner, maxPages: 200 };
      for (const dv of dvs) {
        if (mapped.has(dv.id)) continue;
        const buf = await deps.storage.get(dv.storageKey);
        if (createHash('sha256').update(buf).digest('hex') !== dv.sha256) throw new Error(`Stored bytes of document version ${dv.id} do not match its sha256.`);
        const added = await addDocumentVersion(tx, deps2, { clientId: dst.clientId, projectId: dst.id, actorId: admin.id, meta: metaOf(dv.document), fileName: dv.fileName, buf, origin: dv.origin === 'SME_PROPOSAL' ? 'UPLOAD' : dv.origin }, audit);
        if (added.version.sha256 !== dv.sha256) throw new Error('The copied document changed while it was stored.');
        mapped.set(dv.id, added.version);
      }
      const texts = new Map<string, { text: string; pages: string[]; format: string }>();
      const textOf = async (v: PolicyDocumentVersion) => texts.get(v.id) ?? texts.set(v.id, { ...(await loadVersionText(deps.storage, v)), format: v.format }).get(v.id)!;
      for (const r of rules) {
        if (existing.has(r.ruleKey)) continue;
        const bySource = r.sources.map((s) => ({ s, dv: mapped.get(s.documentVersionId)! }));
        const first = bySource[0]?.dv;
        if (!first) throw new Error(`Rule ${r.ruleKey} has no source document.`);
        const cite = (s: (typeof r.sources)[number]) => CandidateCitation.parse({ fieldPath: s.fieldPath, role: s.role, quote: s.quote });
        const created = await createRuleFromCandidate(tx, {
          clientId: dst.clientId,
          projectId: dst.id,
          documentVersion: first,
          doc: await textOf(first),
          candidate: { ...PolicyRuleBody.parse(r.body), ruleKey: r.ruleKey, citations: bySource.filter((x) => x.dv.id === first.id).map((x) => cite(x.s)) },
          origin: 'library_copy',
          editedById: admin.id,
          ruleKey: r.ruleKey,
          state: 'DRAFT',
          annotationSave: { source: 'AUTHOR_EDIT', editedById: admin.id },
        });
        const extra = bySource.filter((x) => x.dv.id !== first.id);
        for (const e of extra) {
          const res = resolveCitation(cite(e.s), await textOf(e.dv));
          await tx.policyCitation.create({ data: { clientId: dst.clientId, ruleVersionId: created.version.id, documentVersionId: e.dv.id, fieldPath: e.s.fieldPath, role: e.s.role, quote: res.quote, locator: res.locator as unknown as Prisma.InputJsonValue, resolution: res.resolution, confirmedById: admin.id } });
        }
        if (extra.length) {
          const all = await tx.policyCitation.findMany({ where: { ruleVersionId: created.version.id } });
          await tx.policyRuleVersion.update({ where: { id: created.version.id }, data: { contentHash: ruleContentHash(PolicyRuleBody.parse(created.version.body), all) } });
        }
        await audit({ entityType: 'PolicyRuleVersion', entityId: created.version.id, action: 'policy.rule_copied_from_library', after: { ruleKey: r.ruleKey, fromProjectId: src.id, fromRuleVersionId: r.ruleVersionId, fromRuleSetVersion: set.version, state: created.version.state, requestedBy: admin.id } });
      }
      return { ...report, outcome: 'copied' };
    },
    { timeout: 120_000 },
  );
}
