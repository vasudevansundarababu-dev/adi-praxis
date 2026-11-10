/**
 * Writes the fictional SEED handoff for Anvil (see src/policy/anvil-seed-export.ts) from a scratch database:
 *
 *   DATABASE_URL=postgresql://…/praxis_anvil_seed pnpm --filter @praxis/api exec tsx scripts/anvil-seed-export.ts <out-dir> [--policy v2]
 *
 * Refuses any database not named praxis_anvil_seed, because the export seeds a new client into it.
 */
import path from 'node:path';
import { createDb } from '../src/db';
import { exportAnvilSeed } from '../src/policy/anvil-seed-export';

const url = process.env.DATABASE_URL ?? '';
if (!process.argv[2]) throw new Error('usage: anvil-seed-export.ts <out-dir> [--policy v2]');
const flag = process.argv.indexOf('--policy');
const policy = flag > 0 ? process.argv[flag + 1] : 'v1';
if (policy !== 'v1' && policy !== 'v2') throw new Error('--policy must be v1 or v2');
if (!/\/praxis_anvil_seed(\?|$)/.test(url)) throw new Error('Refusing: DATABASE_URL must be the scratch database praxis_anvil_seed');
const out = path.resolve(process.argv[2]);
const db = createDb(url);
try {
  const r = await exportAnvilSeed(db, out, { policy });
  console.log(`Wrote ${r.projects} projects (${r.tasks} tasks) to ${out}`);
} finally {
  await db.$disconnect();
}
