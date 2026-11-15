import type { Db } from '../db';

/**
 * QA-only template cleanup (owner, 15 Nov 2026: "Only two templates from Anvil. Rest of the templates you can delete
 * it."). Run after qa-project-cleanup, so most templates are no longer used by a live project.
 *
 * The templates to keep are named explicitly (`keep`, by id). The dry run lists every template with an "Anvil" mark
 * (it has an Anvil spec or came from an Anvil template proposal) so the owner can pick them.
 *
 * For every other template, one at a time, each in its own transaction:
 * - **Kept untouched:** older or newer versions in the same lineage as a kept template. Published history stays
 *   immutable, and PMs only ever see the newest version.
 * - **Retired** (status RETIRED, content unchanged) when the template has protected history: approved task records,
 *   SME-authored tasks, template proposals, qualifications or Anvil revocation events (append-only), or any project
 *   still pointing at it (a cancelled project with locked history).
 * - **Deleted** otherwise, with its own rows: generation runs, studio deployments, policy profiles. Any template that
 *   names it as `variantOf` is unlinked first.
 * - Database triggers are never disabled; a database refusal rolls that template back and retires it instead.
 * - Every deletion and retirement is audited (actor SYSTEM, `qa-template-cleanup`).
 *
 * Dry run by default; `apply: true` changes data. Idempotent.
 */
export interface TemplateCleanupOutcome {
  id: string;
  name: string;
  version: number;
  status: string;
  fromAnvil: boolean;
  outcome: 'kept' | 'kept_same_lineage' | 'deleted' | 'would_delete' | 'retired' | 'would_retire' | 'already_retired';
  reasons: string[];
  rows?: Record<string, number>;
}

const ACTOR = 'qa-template-cleanup';
type Q = { $queryRawUnsafe<T = unknown>(sql: string, ...v: unknown[]): Promise<T>; $executeRawUnsafe(sql: string, ...v: unknown[]): Promise<number> };
const count = async (tx: Q, sql: string, ...v: unknown[]) => Number(((await tx.$queryRawUnsafe<{ n: bigint }[]>(sql, ...v))[0]?.n ?? 0n));

async function protectedHistory(tx: Q, t: string): Promise<string[]> {
  const checks: [string, string][] = [
    ['projects', `SELECT count(*) AS n FROM "Project" WHERE template_id = $1::uuid`],
    ['approved task records', `SELECT count(*) AS n FROM "ApprovedTaskRecord" WHERE template_id = $1::uuid`],
    ['SME-authored tasks', `SELECT count(*) AS n FROM "SmeAuthoredTask" WHERE template_id = $1::uuid`],
    ['template proposals', `SELECT count(*) AS n FROM "TemplateProposal" WHERE template_id = $1::uuid`],
    ['template qualifications', `SELECT count(*) AS n FROM "TemplateQualification" WHERE template_id = $1::uuid`],
    ['Anvil revocation events', `SELECT count(*) AS n FROM "AnvilRevocationEvent" WHERE template_id = $1::uuid`],
  ];
  const out: string[] = [];
  for (const [label, sql] of checks) {
    const n = await count(tx, sql, t);
    if (n) out.push(`${n} ${label}`);
  }
  return out;
}

async function deleteTemplate(tx: Q, t: string) {
  const rows: Record<string, number> = {};
  const run = async (table: string, sql: string) => {
    const n = await tx.$executeRawUnsafe(sql, t);
    if (n) rows[table] = (rows[table] ?? 0) + n;
  };
  await run('Template (variant unlinked)', `UPDATE "Template" SET variant_of_id = NULL, updated_at = now() WHERE variant_of_id = $1::uuid`);
  for (const table of ['CompilerGenerationRun', 'StudioDeployment', 'TemplatePolicyProfile', 'ProjectPolicyRequirement'])
    await run(table, `DELETE FROM "${table}" WHERE template_id = $1::uuid`);
  await run('Template', `DELETE FROM "Template" WHERE id = $1::uuid`);
  return rows;
}

const audit = (tx: Q, clientId: string, t: string, action: string, before: object, after: object) =>
  tx.$executeRawUnsafe(
    `INSERT INTO "AuditEvent" (client_id, actor_type, actor_id, entity_type, entity_id, action, before, after) VALUES ($1::uuid, 'SYSTEM', $2, 'Template', $3, $4, $5::jsonb, $6::jsonb)`,
    clientId, ACTOR, t, action, JSON.stringify(before), JSON.stringify(after),
  );

const REASON = 'QA cleanup: owner asked to keep only the two Anvil templates';

export async function cleanupTemplates(db: Db, opts: { keep: string[]; apply: boolean; log?: (m: string, extra?: object) => void }): Promise<TemplateCleanupOutcome[]> {
  const log = opts.log ?? (() => {});
  const keep = [...new Set(opts.keep.map((k) => k.toLowerCase()))];
  const templates = await db.template.findMany({ orderBy: [{ workflowName: 'asc' }, { version: 'asc' }] });
  const anvil = new Set((await db.$queryRawUnsafe<{ id: string }[]>(`SELECT DISTINCT template_id AS id FROM "TemplateProposal" WHERE template_id IS NOT NULL`)).map((r) => r.id));
  const missing = keep.filter((k) => !templates.some((t) => t.id === k));
  if (missing.length) throw new Error(`Templates to keep not found: ${missing.join(', ')}`);
  if (opts.apply && keep.length === 0) throw new Error('Name the templates to keep (--keep <id>); refusing to remove every template');
  const keptLineages = new Set(templates.filter((t) => keep.includes(t.id)).map((t) => t.lineageId));

  const out: TemplateCleanupOutcome[] = [];
  for (const t of templates) {
    const base = { id: t.id, name: t.workflowName, version: t.version, status: t.status, fromAnvil: t.anvilSpec !== null || anvil.has(t.id) };
    if (keep.includes(t.id)) { out.push({ ...base, outcome: 'kept', reasons: [] }); continue; }
    if (keptLineages.has(t.lineageId)) { out.push({ ...base, outcome: 'kept_same_lineage', reasons: ['another version of a kept template'] }); continue; }
    const reasons = await db.$transaction(async (tx) => protectedHistory(tx as unknown as Q, t.id));
    if (reasons.length && t.status === 'RETIRED') { out.push({ ...base, outcome: 'already_retired', reasons }); continue; }
    if (!opts.apply) { out.push({ ...base, outcome: reasons.length ? 'would_retire' : 'would_delete', reasons }); continue; }
    const snapshot = { workflowName: t.workflowName, version: t.version, status: t.status, lineageId: t.lineageId };
    if (!reasons.length) {
      try {
        const rows = await db.$transaction(async (tx) => {
          const q = tx as unknown as Q;
          const again = await protectedHistory(q, t.id); // re-checked inside the deleting transaction
          if (again.length) throw Object.assign(new Error('protected'), { reasons: again });
          const r = await deleteTemplate(q, t.id);
          await audit(q, t.clientId, t.id, 'template.hard_deleted', snapshot, { deletedRows: r, by: ACTOR, reason: REASON });
          return r;
        }, { timeout: 60_000 });
        out.push({ ...base, outcome: 'deleted', reasons: [], rows });
        log('template deleted', { templateId: t.id, rows });
        continue;
      } catch (e) {
        const r = (e as { reasons?: string[] }).reasons;
        reasons.push(...(r ?? [`database refused the delete (${(e as { code?: string }).code ?? (e as Error).message.slice(0, 160)}); retired instead`]));
      }
    }
    if (t.status === 'RETIRED') { out.push({ ...base, outcome: 'already_retired', reasons }); continue; }
    await db.$transaction(async (tx) => {
      const q = tx as unknown as Q;
      await q.$executeRawUnsafe(`UPDATE "Template" SET status = 'RETIRED', retired_at = now(), updated_at = now() WHERE id = $1::uuid AND status <> 'RETIRED'`, t.id);
      await audit(q, t.clientId, t.id, 'template.retired', snapshot, { status: 'RETIRED', by: ACTOR, reason: `${REASON}; kept because of protected history (${reasons.join('; ')})` });
    });
    out.push({ ...base, outcome: 'retired', reasons });
    log('template retired', { templateId: t.id, reasons });
  }
  return out;
}
