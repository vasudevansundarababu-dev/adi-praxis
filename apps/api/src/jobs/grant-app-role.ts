import type { Db } from '../db';

/** Tables the application may only read and append to (SPEC Security; enforced also by triggers). */
export const APPEND_ONLY_TABLES = ['ApprovedTaskRecord', 'RLReviewRecord', 'AuditEvent', 'SelectionDecision', 'TaskReview', 'CandidateStateEvent', 'SmeStanding', 'EarningEntry', 'PartnerFeeEntry'] as const;

/**
 * Grants the runtime database role what the app needs, and nothing more: read/write on ordinary tables, read and
 * insert only on append-only tables, no DDL. The migration role owns the schema. Idempotent; run after migrations.
 */
export async function grantAppRole(db: Db, role: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error(`Invalid role name: ${role}`);
  const q = (sql: string) => db.$executeRawUnsafe(sql);
  await q(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`);
  await q(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
  for (const t of APPEND_ONLY_TABLES) await q(`REVOKE UPDATE, DELETE, TRUNCATE ON "${t}" FROM "${role}"`);
  await q(`REVOKE ALL ON "_prisma_migrations" FROM "${role}"`);
  await q(`REVOKE CREATE ON SCHEMA public FROM "${role}"`);
}
