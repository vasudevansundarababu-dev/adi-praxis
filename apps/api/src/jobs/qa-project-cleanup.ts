import type { Db } from '../db';

/**
 * QA-only project cleanup (owner, 13 Nov 2026: "delete all projects ... we will start from scratch. Don't delete SME
 * users and other stuff"; hard delete chosen, protected history cancelled instead).
 *
 * Works one project at a time, each in its own transaction:
 * - **Protected history** stays and is never forced. A project is kept if it, or anything under it, has rows in an
 *   append-only or immutable table (approved records, reviews, SME-authored tasks, policy snapshots, selection
 *   decisions, candidate events, earnings, partner fees, rule sets, policy documents/rules, validation runs, policy
 *   proposals). A kept project that is not already CANCELLED is cancelled.
 * - **Everything else** under the project is deleted, children first, then the project itself.
 * - Users, SME profiles, templates, domains, uploaded forms and the audit log are never touched. Database triggers are
 *   never disabled; any database refusal rolls that project back and keeps it.
 * - Every deletion and cancellation is audited (actor SYSTEM, `qa-project-cleanup`).
 *
 * Dry run by default; `apply: true` changes data. Idempotent: deleted projects are gone, cancellations are not repeated.
 */
export interface CleanupOutcome {
  id: string;
  name: string;
  status: string;
  outcome: 'deleted' | 'would_delete' | 'kept_cancelled' | 'kept_already_cancelled' | 'would_keep_and_cancel' | 'would_keep';
  reasons: string[];
  deletedRows?: Record<string, number>;
}

const ACTOR = 'qa-project-cleanup';

type Q = { $queryRawUnsafe<T = unknown>(sql: string, ...v: unknown[]): Promise<T>; $executeRawUnsafe(sql: string, ...v: unknown[]): Promise<number> };

const ids = async (tx: Q, sql: string, ...v: unknown[]) => ((await tx.$queryRawUnsafe<{ id: string }[]>(sql, ...v)) ?? []).map((r) => r.id);
const count = async (tx: Q, sql: string, ...v: unknown[]) => Number(((await tx.$queryRawUnsafe<{ n: bigint }[]>(sql, ...v))[0]?.n ?? 0n));

/** The project's tree, by id. */
async function tree(tx: Q, p: string) {
  const tasks = await ids(tx, `SELECT id FROM "TaskInstance" WHERE project_id = $1::uuid`, p);
  const pas = await ids(tx, `SELECT id FROM "ProjectAssignment" WHERE project_id = $1::uuid`, p);
  const opps = await ids(tx, `SELECT id FROM "Opportunity" WHERE project_id = $1::uuid`, p);
  const enr = await ids(tx, `SELECT id FROM "Enrollment" WHERE opportunity_id = ANY($1::uuid[])`, opps);
  const smeas = await ids(tx, `SELECT id FROM "SmeAssignment" WHERE project_id = $1::uuid OR enrollment_id = ANY($2::uuid[])`, p, enr);
  const reqs = await ids(tx, `SELECT id FROM "Requisition" WHERE project_id = $1::uuid`, p);
  const subs = await ids(tx, `SELECT id FROM "PartnerSubmission" WHERE requisition_id = ANY($1::uuid[])`, reqs);
  const campaigns = await ids(tx, `SELECT id FROM "Campaign" WHERE project_id = $1::uuid`, p);
  return { tasks, pas, opps, enr, smeas, reqs, subs, campaigns };
}

/** Protected (append-only / immutable) history under the project. Empty = deletable. */
async function protectedHistory(tx: Q, p: string, t: Awaited<ReturnType<typeof tree>>): Promise<string[]> {
  const sources = [...t.tasks, ...t.pas, ...t.smeas, ...t.enr, ...t.subs];
  const checks: [string, string, unknown[]][] = [
    ['approved task records', `SELECT count(*) AS n FROM "ApprovedTaskRecord" WHERE project_id = $1::uuid OR task_instance_id = ANY($2::uuid[])`, [p, t.tasks]],
    ['task reviews', `SELECT count(*) AS n FROM "TaskReview" WHERE task_instance_id = ANY($1::uuid[])`, [t.tasks]],
    ['SME-authored tasks', `SELECT count(*) AS n FROM "SmeAuthoredTask" WHERE project_id = $1::uuid OR task_instance_id = ANY($2::uuid[])`, [p, t.tasks]],
    ['task policy snapshots', `SELECT count(*) AS n FROM "TaskPolicySnapshot" WHERE task_instance_id = ANY($1::uuid[])`, [t.tasks]],
    ['SME selection decisions', `SELECT count(*) AS n FROM "SelectionDecision" WHERE enrollment_id = ANY($1::uuid[])`, [t.enr]],
    ['candidate state events', `SELECT count(*) AS n FROM "CandidateStateEvent" WHERE submission_id = ANY($1::uuid[])`, [t.subs]],
    ['partner fee entries', `SELECT count(*) AS n FROM "PartnerFeeEntry" WHERE submission_id = ANY($1::uuid[])`, [t.subs]],
    ['earnings', `SELECT count(*) AS n FROM "EarningEntry" WHERE requisition_id = ANY($1::uuid[]) OR source_id = ANY($2::text[])`, [t.reqs, sources]],
    ['project rule sets', `SELECT count(*) AS n FROM "ProjectRuleSet" WHERE project_id = $1::uuid`, [p]],
    ['policy documents', `SELECT count(*) AS n FROM "PolicyDocument" WHERE project_id = $1::uuid`, [p]],
    ['policy rules', `SELECT count(*) AS n FROM "PolicyRule" WHERE project_id = $1::uuid`, [p]],
    ['policy proposals', `SELECT count(*) AS n FROM "PolicyProposal" WHERE project_id = $1::uuid`, [p]],
    ['policy extraction batches', `SELECT count(*) AS n FROM "ExtractionBatch" WHERE project_id = $1::uuid`, [p]],
    ['export validation runs', `SELECT count(*) AS n FROM "ProjectValidationRun" WHERE project_id = $1::uuid`, [p]],
  ];
  const out: string[] = [];
  for (const [label, sql, v] of checks) {
    const n = await count(tx, sql, ...v);
    if (n) out.push(`${n} ${label}`);
  }
  return out;
}

/** Deletes the (unprotected) tree, children first. Returns rows deleted per table. */
async function deleteTree(tx: Q, p: string, t: Awaited<ReturnType<typeof tree>>) {
  const rows: Record<string, number> = {};
  const del = async (table: string, sql: string, ...v: unknown[]) => {
    const n = await tx.$executeRawUnsafe(sql, ...v);
    if (n) rows[table] = (rows[table] ?? 0) + n;
  };
  await del('Invite', `DELETE FROM "Invite" WHERE project_assignment_id = ANY($1::uuid[])`, t.pas);
  for (const table of ['SimilarityCheck', 'TaskSubmission', 'TaskSource', 'TaskInterviewTurn', 'TaskDraftRun'])
    await del(table, `DELETE FROM "${table}" WHERE task_instance_id = ANY($1::uuid[])`, t.tasks);
  await del('TaskInstance', `DELETE FROM "TaskInstance" WHERE project_id = $1::uuid`, p);
  await del('ProjectAssignment', `DELETE FROM "ProjectAssignment" WHERE project_id = $1::uuid`, p);
  await del('Application', `DELETE FROM "Application" WHERE campaign_id = ANY($1::uuid[])`, t.campaigns);
  await del('Campaign', `DELETE FROM "Campaign" WHERE project_id = $1::uuid`, p);
  await del('ConversationTurn', `DELETE FROM "ConversationTurn" WHERE session_id IN (SELECT id FROM "ConversationSession" WHERE enrollment_id = ANY($1::uuid[]))`, t.enr);
  await del('ConversationSession', `DELETE FROM "ConversationSession" WHERE enrollment_id = ANY($1::uuid[])`, t.enr);
  await del('QualificationScope', `DELETE FROM "QualificationScope" WHERE enrollment_id = ANY($1::uuid[])`, t.enr);
  await del('SuitabilityAssessment', `DELETE FROM "SuitabilityAssessment" WHERE enrollment_id = ANY($1::uuid[])`, t.enr);
  await del('OnboardingAcknowledgement', `DELETE FROM "OnboardingAcknowledgement" WHERE checklist_id IN (SELECT id FROM "OnboardingChecklist" WHERE enrollment_id = ANY($1::uuid[]))`, t.enr);
  await del('OnboardingChecklist', `DELETE FROM "OnboardingChecklist" WHERE enrollment_id = ANY($1::uuid[])`, t.enr);
  await del('SmeAssignment', `DELETE FROM "SmeAssignment" WHERE id = ANY($1::uuid[])`, t.smeas);
  await del('Enrollment', `DELETE FROM "Enrollment" WHERE id = ANY($1::uuid[])`, t.enr);
  await del('OpportunityDocument', `DELETE FROM "OpportunityDocument" WHERE opportunity_id = ANY($1::uuid[])`, t.opps);
  await del('OpportunityVersion', `DELETE FROM "OpportunityVersion" WHERE opportunity_id = ANY($1::uuid[])`, t.opps);
  await del('Opportunity', `DELETE FROM "Opportunity" WHERE project_id = $1::uuid`, p);
  await del('PartnerSubmission', `DELETE FROM "PartnerSubmission" WHERE requisition_id = ANY($1::uuid[])`, t.reqs);
  await del('Requisition', `DELETE FROM "Requisition" WHERE project_id = $1::uuid`, p);
  for (const table of ['StudioDeployment', 'ProjectMatch', 'ProjectMatchRejection', 'ProjectReviewer', 'CoverageSlot', 'TaskInputBatch', 'ProjectPolicyRequirement', 'ProjectExtractionSetting', 'ProjectDemographicFilter'])
    await del(table, `DELETE FROM "${table}" WHERE project_id = $1::uuid`, p);
  await del('Project', `DELETE FROM "Project" WHERE id = $1::uuid`, p);
  // The project's own job descriptions, when no other project uses them (kept otherwise).
  await tx.$executeRawUnsafe('SAVEPOINT jd');
  try {
    await del('JobDescription', `DELETE FROM "JobDescription" j WHERE j.project_id = $1::uuid AND NOT EXISTS (SELECT 1 FROM "Project" o WHERE o.job_description_id = j.id OR o.reviewer_job_description_id = j.id)`, p);
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT jd');
  } catch {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT jd');
  }
  return rows;
}

const audit = (tx: Q, clientId: string, projectId: string, action: string, before: object, after: object | null) =>
  tx.$executeRawUnsafe(
    `INSERT INTO "AuditEvent" (client_id, actor_type, actor_id, entity_type, entity_id, action, before, after) VALUES ($1::uuid, 'SYSTEM', $2, 'Project', $3, $4, $5::jsonb, $6::jsonb)`,
    clientId, ACTOR, projectId, action, JSON.stringify(before), after === null ? null : JSON.stringify(after),
  );

export async function cleanupProjects(db: Db, opts: { apply: boolean; log?: (m: string, extra?: object) => void }): Promise<CleanupOutcome[]> {
  const log = opts.log ?? (() => {});
  const projects = await db.project.findMany({ select: { id: true, clientId: true, name: true, status: true, templateId: true, templateVersion: true }, orderBy: { createdAt: 'asc' } });
  const out: CleanupOutcome[] = [];
  for (const p of projects) {
    const snapshot = { name: p.name, status: p.status, templateId: p.templateId, templateVersion: p.templateVersion };
    // Read-only classification first.
    const reasons = await db.$transaction(async (tx) => protectedHistory(tx as unknown as Q, p.id, await tree(tx as unknown as Q, p.id)));
    if (!opts.apply) {
      out.push({ id: p.id, name: p.name, status: p.status, outcome: reasons.length ? (p.status === 'CANCELLED' ? 'would_keep' : 'would_keep_and_cancel') : 'would_delete', reasons });
      continue;
    }
    let deleted: Record<string, number> | null = null;
    if (!reasons.length) {
      try {
        deleted = await db.$transaction(
          async (tx) => {
            const q = tx as unknown as Q;
            const t = await tree(q, p.id);
            const again = await protectedHistory(q, p.id, t); // re-checked inside the deleting transaction
            if (again.length) throw Object.assign(new Error('protected'), { reasons: again });
            const rows = await deleteTree(q, p.id, t);
            await audit(q, p.clientId, p.id, 'project.hard_deleted', snapshot, { deletedRows: rows, by: ACTOR, reason: 'QA cleanup: owner asked to delete all projects and start from scratch' });
            return rows;
          },
          { timeout: 120_000 },
        );
      } catch (e) {
        const r = (e as { reasons?: string[] }).reasons;
        reasons.push(...(r ?? [`database refused the delete (${(e as { code?: string }).code ?? (e as Error).message.slice(0, 160)}); nothing was deleted`]));
      }
    }
    if (deleted) {
      out.push({ id: p.id, name: p.name, status: p.status, outcome: 'deleted', reasons: [], deletedRows: deleted });
      log('project deleted', { projectId: p.id, rows: deleted });
      continue;
    }
    if (p.status === 'CANCELLED') {
      out.push({ id: p.id, name: p.name, status: p.status, outcome: 'kept_already_cancelled', reasons });
      continue;
    }
    await db.$transaction(async (tx) => {
      const q = tx as unknown as Q;
      const n = await q.$executeRawUnsafe(`UPDATE "Project" SET status = 'CANCELLED', updated_at = now() WHERE id = $1::uuid AND status <> 'CANCELLED'`, p.id);
      if (n) await audit(q, p.clientId, p.id, 'project.cancelled', snapshot, { status: 'CANCELLED', by: ACTOR, reason: `QA cleanup: kept because of protected history (${reasons.join('; ')})` });
    });
    out.push({ id: p.id, name: p.name, status: p.status, outcome: 'kept_cancelled', reasons });
    log('project kept and cancelled', { projectId: p.id, reasons });
  }
  return out;
}
