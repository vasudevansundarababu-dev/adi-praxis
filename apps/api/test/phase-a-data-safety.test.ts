import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dataDigests } from '../src/jobs/data-digests';
import { db } from './helpers';

/**
 * Owner (24 Nov 2026): "keep the existing tasks which I authored". Phase A migrations are additive only (new tables,
 * new nullable columns, widened checks): none updates, deletes, re-keys or drops an existing task, revision, approval
 * or export. The data-digests job (run before and after each migration on the dev database) must read back equal.
 */
const DIR = path.resolve(import.meta.dirname, '../prisma/migrations');
const PHASE_A = readdirSync(DIR).filter((d) => /^\d{14}_/.test(d) && d >= '20261208000000');

describe('Phase A migrations keep existing data', () => {
  afterAll(async () => db.$disconnect());

  it('are additive only', () => {
    expect(PHASE_A.length).toBeGreaterThanOrEqual(4);
    for (const d of PHASE_A) {
      const sql = readFileSync(path.join(DIR, d, 'migration.sql'), 'utf8').replace(/--.*$/gm, '');
      expect(sql, d).not.toMatch(/^\s*(UPDATE|DELETE|TRUNCATE)\b|\bDROP\s+TABLE\b|\bDROP\s+COLUMN\b|\bRENAME\b|\bALTER\s+COLUMN\b/im);
      // A dropped check constraint is only ever re-added wider in the same migration.
      for (const m of sql.matchAll(/DROP CONSTRAINT "([^"]+)"/g)) expect(sql, `${d}: ${m[1]}`).toMatch(new RegExp(`ADD CONSTRAINT "${m[1]}"`));
      for (const m of sql.matchAll(/ADD COLUMN "[^"]+" ([^;]+);/g)) expect(m[1], d).not.toMatch(/NOT NULL(?! DEFAULT)/);
    }
  });

  it('the digest job reads the same values twice (read-only)', async () => {
    const a = await dataDigests(db);
    const b = await dataDigests(db);
    expect(b).toEqual(a);
    expect(Object.keys(a)).toEqual(['TaskInstance', 'ApprovedTaskRecord', 'AuthoredTaskPackage', 'TaskSubmission', 'RlGymProjectExport']);
  });
});
