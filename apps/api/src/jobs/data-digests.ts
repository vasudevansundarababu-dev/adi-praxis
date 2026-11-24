import type { Db } from '../db';

/**
 * Owner (24 Nov 2026): "keep the existing tasks which I authored". Before and after every migration, these counts and
 * content digests must be equal: tasks (revision, status, output, benchmark), approved records (content hash, output,
 * chain), packages, submissions and benchmark exports. Read-only. `data-digests` prints them as one JSON line.
 */
export const DIGEST_QUERIES: Record<string, string> = {
  TaskInstance: `SELECT count(*)::int AS n, md5(coalesce(string_agg(id::text||':'||revision||':'||status||':'||md5(coalesce(output::text,''))||':'||md5(coalesce(benchmark::text,'')), ',' ORDER BY id),'')) AS d FROM "TaskInstance"`,
  ApprovedTaskRecord: `SELECT count(*)::int AS n, md5(coalesce(string_agg(id::text||':'||content_hash||':'||md5(output::text)||':'||coalesce(prev_hash,''), ',' ORDER BY id),'')) AS d FROM "ApprovedTaskRecord"`,
  AuthoredTaskPackage: `SELECT count(*)::int AS n, md5(coalesce(string_agg(record_id::text||':'||md5(content), ',' ORDER BY record_id),'')) AS d FROM "AuthoredTaskPackage"`,
  TaskSubmission: `SELECT count(*)::int AS n, md5(coalesce(string_agg(id::text||':'||version||':'||md5(output::text), ',' ORDER BY id),'')) AS d FROM "TaskSubmission"`,
  RlGymProjectExport: `SELECT count(*)::int AS n, md5(coalesce(string_agg(id::text||':'||export_sha256||':'||md5(body::text)||':'||md5(tasks::text), ',' ORDER BY id),'')) AS d FROM "RlGymProjectExport"`,
};

export async function dataDigests(db: Db): Promise<Record<string, { count: number; digest: string }>> {
  const out: Record<string, { count: number; digest: string }> = {};
  for (const [table, sql] of Object.entries(DIGEST_QUERIES)) {
    const [row] = await db.$queryRawUnsafe<{ n: number; d: string }[]>(sql);
    out[table] = { count: row!.n, digest: row!.d };
  }
  return out;
}
