import type { Db } from '../db';

/**
 * QA-only SME cleanup (owner, 14 Nov 2026: "Delete all SME ... Delete All the users and Purge all the data"; console
 * users, templates and projects are out of scope; projects have their own job, qa-project-cleanup).
 *
 * Works one SME (SmeUser) at a time, each in its own transaction:
 * - **No protected history:** the SME and everything about them are hard-deleted, children first: sign-in identities,
 *   sessions, identity attempts, consents, conflicts, profile versions, credentials, experience, evidence rows,
 *   enrollments with their conversations, assessments, onboarding and scopes, matches, proposals and assignments.
 * - **Protected history** (append-only or immutable rows: selection decisions, approved task records, SME-authored
 *   tasks, earnings, standings, policy proposals, payouts, certifications, or tasks issued to them): those rows stay and
 *   are never forced. The SME is **retired** instead: sign-in identities and sessions deleted (they cannot sign in;
 *   the same email later starts a brand-new account), matches and rejections deleted, open applications withdrawn,
 *   proposed or accepted work with no task issued cancelled and their project assignments released, the candidate marked deleted and the account
 *   CLOSED and anonymised (name and contact email cleared). Matching already skips deleted and non-active candidates.
 * - Database triggers are never disabled; any database refusal rolls that SME back and retires them instead.
 * - Every deletion and retirement is audited (actor SYSTEM, `qa-sme-cleanup`), without the person's name or email.
 * - Evidence files in storage are not touched here; the rows that point at them are (QA data is synthetic).
 *
 * Dry run by default; `apply: true` changes data. Idempotent: deleted SMEs are gone, retired ones are skipped.
 */
export interface SmeCleanupOutcome {
  smeUserId: string;
  outcome: 'deleted' | 'would_delete' | 'retired' | 'would_retire' | 'already_retired';
  reasons: string[];
  rows?: Record<string, number>;
}

const ACTOR = 'qa-sme-cleanup';

type Q = { $queryRawUnsafe<T = unknown>(sql: string, ...v: unknown[]): Promise<T>; $executeRawUnsafe(sql: string, ...v: unknown[]): Promise<number> };

const ids = async (tx: Q, sql: string, ...v: unknown[]) => ((await tx.$queryRawUnsafe<{ id: string }[]>(sql, ...v)) ?? []).map((r) => r.id);
const count = async (tx: Q, sql: string, ...v: unknown[]) => Number(((await tx.$queryRawUnsafe<{ n: bigint }[]>(sql, ...v))[0]?.n ?? 0n));

/** The SME's rows, by id. `who` holds both ids, since some tables key on the candidate and some on the user. */
async function tree(tx: Q, s: string) {
  const candidate = (await ids(tx, `SELECT id FROM "Candidate" WHERE sme_user_id = $1::uuid`, s))[0] ?? null;
  const enr = await ids(tx, `SELECT id FROM "Enrollment" WHERE sme_user_id = $1::uuid`, s);
  const pvs = await ids(tx, `SELECT id FROM "ProfileVersion" WHERE sme_user_id = $1::uuid`, s);
  const pas = candidate ? await ids(tx, `SELECT id FROM "ProjectAssignment" WHERE candidate_id = $1::uuid OR enrollment_id = ANY($2::uuid[])`, candidate, enr) : await ids(tx, `SELECT id FROM "ProjectAssignment" WHERE enrollment_id = ANY($1::uuid[])`, enr);
  return { candidate, who: candidate ? [s, candidate] : [s], enr, pvs, pas };
}
type Tree = Awaited<ReturnType<typeof tree>>;

/** Protected history about the SME. Empty = deletable. */
async function protectedHistory(tx: Q, s: string, t: Tree): Promise<string[]> {
  const checks: [string, string, unknown[]][] = [
    ['selection decisions', `SELECT count(*) AS n FROM "SelectionDecision" WHERE enrollment_id = ANY($1::uuid[])`, [t.enr]],
    ['approved task records', `SELECT count(*) AS n FROM "ApprovedTaskRecord" WHERE candidate_id = ANY($1::uuid[])`, [t.who]],
    ['SME-authored tasks', `SELECT count(*) AS n FROM "SmeAuthoredTask" WHERE candidate_id = ANY($1::uuid[])`, [t.who]],
    ['issued tasks', `SELECT count(*) AS n FROM "TaskInstance" WHERE assigned_to_id = ANY($1::uuid[]) OR project_assignment_id = ANY($2::uuid[])`, [t.who, t.pas]],
    ['coverage slots held', `SELECT count(*) AS n FROM "CoverageSlot" WHERE assigned_to_id = ANY($1::uuid[])`, [t.who]],
    ['studio deployments', `SELECT count(*) AS n FROM "StudioDeployment" WHERE candidate_id = ANY($1::uuid[])`, [t.who]],
    ['earnings', `SELECT count(*) AS n FROM "EarningEntry" WHERE sme_user_id = $1::uuid`, [s]],
    ['standings', `SELECT count(*) AS n FROM "SmeStanding" WHERE sme_user_id = $1::uuid`, [s]],
    ['policy proposals', `SELECT count(*) AS n FROM "PolicyProposal" WHERE sme_user_id = $1::uuid`, [s]],
    ['payout items', `SELECT count(*) AS n FROM "PayoutItem" WHERE sme_user_id = $1::uuid`, [s]],
    ['pay holds', `SELECT count(*) AS n FROM "PayHold" WHERE sme_user_id = $1::uuid`, [s]],
    ['payee record', `SELECT count(*) AS n FROM "Payee" WHERE sme_user_id = $1::uuid`, [s]],
    ['certifications', `SELECT count(*) AS n FROM "Certification" WHERE sme_user_id = $1::uuid`, [s]],
    ['certification test attempts', `SELECT count(*) AS n FROM "TestAttempt" WHERE sme_user_id = $1::uuid`, [s]],
    ['partner supply records', `SELECT count(*) AS n FROM "SupplyCandidate" WHERE sme_user_id = $1::uuid`, [s]],
  ];
  const out: string[] = [];
  for (const [label, sql, v] of checks) {
    const n = await count(tx, sql, ...v);
    if (n) out.push(`${n} ${label}`);
  }
  return out;
}

function counter() {
  const rows: Record<string, number> = {};
  return {
    rows,
    run: async (tx: Q, table: string, sql: string, ...v: unknown[]) => {
      const n = await tx.$executeRawUnsafe(sql, ...v);
      if (n) rows[table] = (rows[table] ?? 0) + n;
    },
  };
}

/** Hard delete of an SME with no protected history, children first. */
async function deleteSme(tx: Q, s: string, t: Tree) {
  const { rows, run } = counter();
  const sessions = `SELECT id FROM "ConversationSession" WHERE enrollment_id = ANY($1::uuid[])`;
  const checklists = `SELECT id FROM "OnboardingChecklist" WHERE enrollment_id = ANY($1::uuid[])`;
  const smeas = `SELECT id FROM "SmeAssignment" WHERE sme_user_id = $1::uuid OR enrollment_id = ANY($2::uuid[])`;
  await run(tx, 'Invite', `DELETE FROM "Invite" WHERE project_assignment_id = ANY($1::uuid[])`, t.pas);
  await run(tx, 'ProjectAssignment', `DELETE FROM "ProjectAssignment" WHERE id = ANY($1::uuid[])`, t.pas);
  for (const table of ['ProjectMatch', 'ProjectMatchRejection']) await run(tx, table, `DELETE FROM "${table}" WHERE candidate_id = ANY($1::uuid[])`, t.who);
  await run(tx, 'Application', `DELETE FROM "Application" WHERE candidate_id = ANY($1::uuid[]) OR enrollment_id = ANY($2::uuid[])`, t.who, t.enr);
  await run(tx, 'ConversationTurn', `DELETE FROM "ConversationTurn" WHERE session_id IN (${sessions})`, t.enr);
  await run(tx, 'ConversationSession', `DELETE FROM "ConversationSession" WHERE enrollment_id = ANY($1::uuid[])`, t.enr);
  for (const table of ['QualificationScope', 'SuitabilityAssessment']) await run(tx, table, `DELETE FROM "${table}" WHERE enrollment_id = ANY($1::uuid[])`, t.enr);
  await run(tx, 'OnboardingAcknowledgement', `DELETE FROM "OnboardingAcknowledgement" WHERE checklist_id IN (${checklists})`, t.enr);
  await run(tx, 'OnboardingChecklist', `DELETE FROM "OnboardingChecklist" WHERE enrollment_id = ANY($1::uuid[])`, t.enr);
  await run(tx, 'SmeAssignment', `DELETE FROM "SmeAssignment" WHERE id IN (${smeas})`, s, t.enr);
  await run(tx, 'Enrollment', `DELETE FROM "Enrollment" WHERE id = ANY($1::uuid[])`, t.enr);
  await run(tx, 'Candidate', `DELETE FROM "Candidate" WHERE sme_user_id = $1::uuid`, s);
  await run(tx, 'CredentialClaimEvidence', `DELETE FROM "_CredentialClaimToEvidenceArtifact" WHERE "B" IN (SELECT id FROM "EvidenceArtifact" WHERE sme_user_id = $1::uuid)`, s);
  for (const table of ['CredentialClaim', 'ExperienceEpisode']) await run(tx, table, `DELETE FROM "${table}" WHERE profile_version_id = ANY($1::uuid[])`, t.pvs);
  for (const table of ['ProfileVersion', 'EvidenceArtifact', 'IdentityAttempt', 'AlternativeIdentityCheck', 'ConflictDeclaration', 'Consent', 'Session', 'ProviderIdentity'])
    await run(tx, table, `DELETE FROM "${table}" WHERE sme_user_id = $1::uuid`, s);
  await run(tx, 'SmeUser', `DELETE FROM "SmeUser" WHERE id = $1::uuid`, s);
  return rows;
}

/** Retirement of an SME whose history must stay: no sign-in, nothing open, invisible to matching, anonymised. */
async function retireSme(tx: Q, s: string, t: Tree) {
  const { rows, run } = counter();
  for (const table of ['Session', 'ProviderIdentity']) await run(tx, table, `DELETE FROM "${table}" WHERE sme_user_id = $1::uuid`, s);
  for (const table of ['ProjectMatch', 'ProjectMatchRejection']) await run(tx, table, `DELETE FROM "${table}" WHERE candidate_id = ANY($1::uuid[])`, t.who);
  await run(tx, 'Enrollment (withdrawn)', `UPDATE "Enrollment" SET status = 'WITHDRAWN', updated_at = now() WHERE sme_user_id = $1::uuid AND status IN ('DRAFT','SUBMITTED','NEEDS_INFORMATION','REVIEW_PENDING','REVIEW_REQUESTED')`, s);
  // Proposed or accepted work with no task issued yet is cancelled, so a retired SME never counts towards staffing.
  const noTasks = `NOT EXISTS (SELECT 1 FROM "ProjectAssignment" pa JOIN "TaskInstance" ti ON ti.project_assignment_id = pa.id WHERE pa.sme_assignment_id = "SmeAssignment".id)`;
  await run(tx, 'SmeAssignment (cancelled)', `UPDATE "SmeAssignment" SET status = 'CANCELED', updated_at = now() WHERE sme_user_id = $1::uuid AND status IN ('PROPOSED','ACCEPTED') AND ${noTasks}`, s);
  await run(tx, 'ProjectAssignment (released)', `UPDATE "ProjectAssignment" SET released_at = now(), updated_at = now() WHERE id = ANY($1::uuid[]) AND released_at IS NULL AND NOT EXISTS (SELECT 1 FROM "TaskInstance" ti WHERE ti.project_assignment_id = "ProjectAssignment".id)`, t.pas);
  await run(tx, 'Candidate (deleted)', `UPDATE "Candidate" SET deleted_at = now(), city = NULL, latitude = NULL, longitude = NULL, updated_at = now() WHERE sme_user_id = $1::uuid AND deleted_at IS NULL`, s);
  await run(tx, 'SmeUser (closed, anonymised)', `UPDATE "SmeUser" SET account_status = 'CLOSED', display_name = 'Deleted SME', contact_email = NULL, anonymized_at = now(), updated_at = now() WHERE id = $1::uuid`, s);
  return rows;
}

const audit = (tx: Q, clientId: string, smeUserId: string, action: string, after: object) =>
  tx.$executeRawUnsafe(
    `INSERT INTO "AuditEvent" (client_id, actor_type, actor_id, entity_type, entity_id, action, before, after) VALUES ($1::uuid, 'SYSTEM', $2, 'SmeUser', $3, $4, NULL, $5::jsonb)`,
    clientId, ACTOR, smeUserId, action, JSON.stringify(after),
  );

const REASON = 'QA cleanup: owner asked to delete all SMEs and start from scratch';

export async function cleanupSmes(db: Db, opts: { apply: boolean; log?: (m: string, extra?: object) => void }): Promise<SmeCleanupOutcome[]> {
  const log = opts.log ?? (() => {});
  const smes = await db.smeUser.findMany({ select: { id: true, clientId: true, anonymizedAt: true, accountStatus: true }, orderBy: { createdAt: 'asc' } });
  const out: SmeCleanupOutcome[] = [];
  for (const s of smes) {
    const reasons = await db.$transaction(async (tx) => protectedHistory(tx as unknown as Q, s.id, await tree(tx as unknown as Q, s.id)));
    const retired = s.anonymizedAt !== null && s.accountStatus === 'CLOSED';
    if (retired && reasons.length) {
      out.push({ smeUserId: s.id, outcome: 'already_retired', reasons });
      continue;
    }
    if (!opts.apply) {
      out.push({ smeUserId: s.id, outcome: reasons.length ? 'would_retire' : 'would_delete', reasons });
      continue;
    }
    if (!reasons.length) {
      try {
        const rows = await db.$transaction(
          async (tx) => {
            const q = tx as unknown as Q;
            const t = await tree(q, s.id);
            const again = await protectedHistory(q, s.id, t); // re-checked inside the deleting transaction
            if (again.length) throw Object.assign(new Error('protected'), { reasons: again });
            const r = await deleteSme(q, s.id, t);
            await audit(q, s.clientId, s.id, 'sme.hard_deleted', { deletedRows: r, by: ACTOR, reason: REASON });
            return r;
          },
          { timeout: 120_000 },
        );
        out.push({ smeUserId: s.id, outcome: 'deleted', reasons: [], rows });
        log('sme deleted', { smeUserId: s.id, rows });
        continue;
      } catch (e) {
        const r = (e as { reasons?: string[] }).reasons;
        reasons.push(...(r ?? [`database refused the delete (${(e as { code?: string }).code ?? (e as Error).message.slice(0, 160)}); retired instead`]));
      }
    }
    const rows = await db.$transaction(async (tx) => {
      const q = tx as unknown as Q;
      const r = await retireSme(q, s.id, await tree(q, s.id));
      await audit(q, s.clientId, s.id, 'sme.retired', { changedRows: r, by: ACTOR, reason: `${REASON}; kept because of protected history (${reasons.join('; ')})` });
      return r;
    });
    out.push({ smeUserId: s.id, outcome: 'retired', reasons, rows });
    log('sme retired', { smeUserId: s.id, reasons });
  }
  return out;
}
