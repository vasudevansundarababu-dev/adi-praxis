import type { Db } from '../db';
import { writeAudit } from '../platform/audit';
import { baseOf, recordContent, recordHash } from './approved-records';
import { rlBaseOf, rlRecordContent, rlRecordHash } from '../rl/rl-records';

export interface ChainBreak {
  seq: string;
  id: string;
  reason: 'CONTENT_CHANGED' | 'LINK_BROKEN';
}
export interface ChainReport {
  table: 'ApprovedTaskRecord' | 'RLReviewRecord';
  checked: number;
  breaks: ChainBreak[];
  lastHash: string | null;
}

/**
 * Recomputes the hash chain in `seq` order: each record's content hash must match its content and its prev_hash
 * must equal the previous record's content hash. Any tampering (even by someone who bypassed the append-only
 * rules) shows up as a break.
 */
export async function verifyApprovedChain(db: Db, batch = 500): Promise<ChainReport> {
  const breaks: ChainBreak[] = [];
  let prev: string | null = null;
  let after = -1n;
  let checked = 0;
  for (;;) {
    const rows = await db.approvedTaskRecord.findMany({ where: { seq: { gt: after } }, orderBy: { seq: 'asc' }, take: batch });
    if (!rows.length) break;
    for (const r of rows) {
      if (r.prevHash !== prev) breaks.push({ seq: String(r.seq), id: r.id, reason: 'LINK_BROKEN' });
      else if (recordHash(recordContent(baseOf(r)), r.prevHash) !== r.contentHash) breaks.push({ seq: String(r.seq), id: r.id, reason: 'CONTENT_CHANGED' });
      prev = r.contentHash;
      checked++;
    }
    after = rows.at(-1)!.seq;
  }
  return { table: 'ApprovedTaskRecord', checked, breaks, lastHash: prev };
}

/** The same check for the RL review chain (FLOW 4). */
export async function verifyRlChain(db: Db, batch = 500): Promise<ChainReport> {
  const breaks: ChainBreak[] = [];
  let prev: string | null = null;
  let after = -1n;
  let checked = 0;
  for (;;) {
    const rows = await db.rLReviewRecord.findMany({ where: { seq: { gt: after } }, orderBy: { seq: 'asc' }, take: batch });
    if (!rows.length) break;
    for (const r of rows) {
      if (r.prevHash !== prev) breaks.push({ seq: String(r.seq), id: r.id, reason: 'LINK_BROKEN' });
      else if (rlRecordHash(rlRecordContent(rlBaseOf(r)), r.prevHash) !== r.contentHash) breaks.push({ seq: String(r.seq), id: r.id, reason: 'CONTENT_CHANGED' });
      prev = r.contentHash;
      checked++;
    }
    after = rows.at(-1)!.seq;
  }
  return { table: 'RLReviewRecord', checked, breaks, lastHash: prev };
}

/**
 * The nightly job: verifies every chain, records the outcome in the audit log, and on any break logs an ERROR
 * entry with `alert: true` (the log-based alert in M8 pages on it).
 */
export async function runChainVerification(db: Db, log: (level: string, msg: string, extra?: object) => void = () => undefined) {
  const reports = [await verifyApprovedChain(db), await verifyRlChain(db)];
  const broken = reports.filter((r) => r.breaks.length);
  const clients = await db.client.findMany({ select: { id: true } });
  for (const c of clients) {
    await db.$transaction((tx) =>
      writeAudit(tx, { clientId: c.id, actorType: 'SYSTEM', actorId: 'dataset-verifier' }, {
        entityType: 'Dataset',
        entityId: c.id,
        action: broken.length ? 'dataset.chain_broken' : 'dataset.chain_verified',
        after: { reports: reports.map((r) => ({ table: r.table, checked: r.checked, breaks: r.breaks.slice(0, 50), lastHash: r.lastHash })) },
      }),
    );
  }
  if (broken.length) log('error', 'dataset hash chain broken', { alert: true, reports: broken });
  else log('info', 'dataset hash chain verified', { checked: reports.map((r) => r.checked) });
  return reports;
}
