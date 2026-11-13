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
 * - `qa-users [--dry-run]`: QA-only synthetic users (30 staffing-ready SMEs, 10 Reviewers) through the public API at
 *   API_URL; never production. Exit 3 when some candidates are not ready yet (re-run to continue).
 * - `qa-project-cleanup [--apply]`: QA-only. Deletes every project without protected history; cancels the rest. Dry run
 *   by default; --apply also needs QA_PROJECT_CLEANUP_CONFIRM=delete-all-projects. Never production.
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
  } else if (job === 'qa-users') {
    if (config.appEnv === 'production') throw new Error('qa-users refuses to run with APP_ENV=production');
    const extra = process.argv.slice(3).filter((a) => a !== '--dry-run');
    if (extra.length) throw new Error(`Unknown qa-users argument "${extra[0]}". Use: --dry-run`);
    const dryRun = process.argv.includes('--dry-run');
    const { fetchHttp, optionsFromEnv, qaUsers } = await import('./qa-users');
    if (!dryRun && !process.env.API_URL) throw new Error('qa-users needs API_URL');
    const { defaultEvaluator } = await import('../app');
    // The job also runs pending or failed assessments with this environment's model (SUITABILITY_MODEL).
    const r = await qaUsers(db, { ...optionsFromEnv(process.env, config.appEnv, dryRun, fetchHttp(process.env.API_URL ?? '')), evaluator: defaultEvaluator(config) }, log);
    if (!dryRun && r.incomplete) process.exitCode = 3;
  } else if (job === 'qa-project-cleanup') {
    if (config.appEnv === 'production') throw new Error('qa-project-cleanup refuses to run with APP_ENV=production');
    const extra = process.argv.slice(3).filter((a) => a !== '--apply');
    if (extra.length) throw new Error(`Unknown qa-project-cleanup argument "${extra[0]}". Use: --apply (default is a dry run)`);
    const apply = process.argv.includes('--apply');
    if (apply && process.env.QA_PROJECT_CLEANUP_CONFIRM !== 'delete-all-projects') throw new Error('qa-project-cleanup --apply needs QA_PROJECT_CLEANUP_CONFIRM=delete-all-projects');
    const { cleanupProjects } = await import('./qa-project-cleanup');
    const r = await cleanupProjects(db, { apply, log: (m, extra) => log('info', m, extra) });
    const tally = r.reduce<Record<string, number>>((a, o) => ({ ...a, [o.outcome]: (a[o.outcome] ?? 0) + 1 }), {});
    log('info', 'qa project cleanup', { apply, tally });
    console.log(JSON.stringify({ report: 'qa-project-cleanup', apply, tally, projects: r }));
  } else if (job === 'catalog-import') {
    const { parseCatalogImportArgs, runCatalogImport } = await import('./catalog-import');
    await runCatalogImport(db, parseCatalogImportArgs(process.argv.slice(3)), log);
  } else {
    throw new Error(`Unknown job "${job}". Use: migrate | verify-chains | bundle-sweep | seed | demo-setup | catalog-v2 | catalog-import | policy-seed | qa-users`);
  }
} catch (err) {
  log('error', 'job failed', { err: String(err), alert: true });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
