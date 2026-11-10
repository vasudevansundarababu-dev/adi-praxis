import { execFileSync } from 'node:child_process';
import { loadConfig } from '../config';
import { createDb } from '../db';
import { runChainVerification } from '../dataset/verify';
import { grantAppRole } from './grant-app-role';

/**
 * Cloud Run job entrypoints (M8):
 * - `migrate`: applies Prisma migrations as the migration role, then grants the runtime role (APP_DB_ROLE).
 * - `verify-chains`: the nightly hash-chain verification, triggered by Cloud Scheduler.
 * - `bundle-sweep`: the nightly deletion of unreferenced Meta-Compiler bundle objects older than 24 hours (D-22).
 * - `seed`: one-time bootstrap of the client, first Admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) and catalog.
 * - `catalog-v2 [--dry-run] [--reverse] [--client <name>]`: the Meta-Compiler catalog change (PRD D15, D15a).
 * - `catalog-import --file <abs-path> --client <clientId> [--dry-run]`: one private template as a client DRAFT.
 * - `policy-seed --client <clientId> --owner <pmUserId>`: fictional SEED policy projects (PRD PR-S01); never production.
 * Exits non-zero on failure so Cloud Run retries and alerts.
 */
const job = process.argv[2];
const log = (level: string, message: string, extra: object = {}) => console.log(JSON.stringify({ severity: level.toUpperCase(), message, job, ...extra }));

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
try {
  if (job === 'migrate') {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
    const role = process.env.APP_DB_ROLE;
    if (role) {
      await grantAppRole(db, role);
      log('info', 'granted runtime role', { role });
    }
  } else if (job === 'verify-chains') {
    const reports = await runChainVerification(db, log);
    if (reports.some((r) => r.breaks.length)) process.exitCode = 2;
  } else if (job === 'bundle-sweep') {
    const { defaultBundleObjectStore, sweepBundles } = await import('../meta-compiler/bundle-sweep');
    const r = await sweepBundles(db, defaultBundleObjectStore(config));
    log('info', 'bundle sweep', { scanned: r.scanned, deleted: r.deleted.length });
  } else if (job === 'demo-setup') {
    if (config.appEnv !== 'demo') throw new Error('demo-setup runs only when APP_ENV=demo');
    const { demoSetup } = await import('./demo-setup');
    await demoSetup(db, process.env, log);
  } else if (job === 'seed') {
    const { seed } = await import('../../prisma/seed');
    const { client, admin } = await seed(db);
    log('info', 'seeded', { client: client.name, admin: admin.email });
  } else if (job === 'catalog-v2') {
    const { parseCatalogV2Args, runCatalogV2 } = await import('./catalog-v2');
    await runCatalogV2(db, parseCatalogV2Args(process.argv.slice(3)), log);
  } else if (job === 'policy-seed') {
    // --client <clientId> --owner <PM userId>: both explicit, so the seed never guesses whose projects these are.
    const arg = (name: string) => {
      const i = process.argv.indexOf(`--${name}`);
      const v = i > 0 ? process.argv[i + 1] : undefined;
      if (!v) throw new Error(`policy-seed needs --${name}`);
      return v;
    };
    const { policySeed } = await import('./policy-seed');
    const { defaultStorage } = await import('../app');
    const r = await policySeed(db, { storage: defaultStorage(config), appEnv: config.appEnv, clientId: arg('client'), ownerId: arg('owner') }, log);
    if (r.missingTemplates.length) process.exitCode = 3;
  } else if (job === 'catalog-import') {
    const { parseCatalogImportArgs, runCatalogImport } = await import('./catalog-import');
    await runCatalogImport(db, parseCatalogImportArgs(process.argv.slice(3)), log);
  } else {
    throw new Error(`Unknown job "${job}". Use: migrate | verify-chains | bundle-sweep | seed | demo-setup | catalog-v2 | catalog-import | policy-seed`);
  }
} catch (err) {
  log('error', 'job failed', { err: String(err), alert: true });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
