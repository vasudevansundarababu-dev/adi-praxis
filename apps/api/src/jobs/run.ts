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
 *   `qa-users --matched --project <id> [--project <id>] [--dry-run]`: instead, the 12 matched KYC and Marketing personas
 *   (qa-personas.ts), only into the named projects, each by its template's track.
 *   `qa-users --accept`: each matched persona accepts the proposals a PM sent them.
 * - `qa-sme-cleanup [--apply]`: QA-only. Deletes every SME without protected history; retires (closes, anonymises) the
 *   rest. Dry run by default; --apply also needs QA_SME_CLEANUP_CONFIRM=delete-all-smes. Never production.
 * - `qa-smoke`: QA-only end-to-end smoke test over the public API at API_URL (real QA infrastructure: live extraction,
 *   live models, the deployed worker). Prints one JSON line `report: "qa-smoke"`; exit 0 only when every step that ran
 *   passed. With the client's MVP1 new flow on (QA_SMOKE_NEW_FLOW=auto|on|off), it also walks the new flow (`forge`).
 *   Never production.
 * - `qa-seed-projects [--apply]`: QA-only. Seeds two SYNTHETIC new-flow projects for Authoring QA on KYC v6
 *   (QA_SEED_PROJECTS_TEMPLATE_ID): "SYNTHETIC QA lifecycle — KYC v6" (tasks New, In progress and Submitted) and
 *   "SYNTHETIC QA all-approved export — KYC v6" (every task Submitted), over the public API at API_URL. Never approves,
 *   rejects or exports: the owner decides every task in the console. Finds the projects by name and continues them.
 *   Dry run by default; --apply also needs QA_SEED_PROJECTS_CONFIRM=create-synthetic-projects. Never production.
 * - `qa-project-cleanup [--apply]`: QA-only. Deletes every project without protected history; cancels the rest. Dry run
 *   by default; --apply also needs QA_PROJECT_CLEANUP_CONFIRM=delete-all-projects. Never production.
 * - `qa-template-cleanup --keep <id> [--keep <id>] [--apply]`: QA-only. Keeps the named templates (and other versions
 *   of the same lineage); deletes every other unused template and retires (archives) the rest. Dry run by default;
 *   --apply also needs QA_TEMPLATE_CLEANUP_CONFIRM=delete-other-templates. Never production.
 * - `case-selector-slots <projectId> [--apply]`: replaces a case-selector project's generic slots with one slot per
 *   value, only while no task has been issued. Dry run by default.
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
    const { parseQaUsersArgs, fetchHttp, optionsFromEnv, qaUsers, acceptProposals } = await import('./qa-users');
    const a = parseQaUsersArgs(process.argv.slice(3));
    if (!a.dryRun && !process.env.API_URL) throw new Error('qa-users needs API_URL');
    const { PERSONAS } = await import('./qa-personas');
    if (a.accept) {
      const r = await acceptProposals(db, { appEnv: config.appEnv, http: fetchHttp(process.env.API_URL!), personas: PERSONAS }, log);
      console.log(JSON.stringify({ report: 'qa-users-accept', proposals: r }));
      if (r.some((x) => x.outcome !== 'accepted')) process.exitCode = 3;
    } else {
      const { defaultEvaluator } = await import('../app');
      const base = optionsFromEnv(process.env, config.appEnv, a.dryRun, fetchHttp(process.env.API_URL ?? ''));
      const matched = a.matched ? { personas: PERSONAS, candidateEmails: PERSONAS.map((p) => p.email), projectIds: a.projectIds } : {};
      // The job also runs pending or failed assessments with this environment's model (SUITABILITY_MODEL).
      const r = await qaUsers(db, { ...base, ...matched, evaluator: defaultEvaluator(config) }, log);
      if (!a.dryRun && r.incomplete) process.exitCode = 3;
    }
  } else if (job === 'qa-smoke') {
    if (config.appEnv === 'production') throw new Error('qa-smoke refuses to run with APP_ENV=production');
    if (process.argv.length > 3) throw new Error(`Unknown qa-smoke argument "${process.argv[3]}". qa-smoke takes no arguments.`);
    if (!process.env.API_URL) throw new Error('qa-smoke needs API_URL');
    const { fetchHttp } = await import('./qa-users');
    const { optionsFromEnv, qaSmoke } = await import('./qa-smoke');
    const r = await qaSmoke(optionsFromEnv(process.env, config.appEnv, fetchHttp(process.env.API_URL)), log);
    console.log(JSON.stringify(r));
    if (!r.ok) process.exitCode = 1;
  } else if (job === 'qa-seed-projects') {
    if (config.appEnv === 'production') throw new Error('qa-seed-projects refuses to run with APP_ENV=production');
    const { parseQaSeedProjectsArgs, optionsFromEnv, qaSeedProjects } = await import('./qa-seed-projects');
    const { apply } = parseQaSeedProjectsArgs(process.argv.slice(3));
    if (!process.env.API_URL) throw new Error('qa-seed-projects needs API_URL');
    const { fetchHttp } = await import('./qa-users');
    const r = await qaSeedProjects(optionsFromEnv(process.env, config.appEnv, fetchHttp(process.env.API_URL), apply), log);
    console.log(JSON.stringify(r));
    if (!r.ok) process.exitCode = 1;
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
  } else if (job === 'qa-sme-cleanup') {
    if (config.appEnv === 'production') throw new Error('qa-sme-cleanup refuses to run with APP_ENV=production');
    const extra = process.argv.slice(3).filter((a) => a !== '--apply');
    if (extra.length) throw new Error(`Unknown qa-sme-cleanup argument "${extra[0]}". Use: --apply (default is a dry run)`);
    const apply = process.argv.includes('--apply');
    if (apply && process.env.QA_SME_CLEANUP_CONFIRM !== 'delete-all-smes') throw new Error('qa-sme-cleanup --apply needs QA_SME_CLEANUP_CONFIRM=delete-all-smes');
    const { cleanupSmes } = await import('./qa-sme-cleanup');
    const r = await cleanupSmes(db, { apply, log: (m, extra) => log('info', m, extra) });
    const tally = r.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.outcome]: (acc[o.outcome] ?? 0) + 1 }), {});
    log('info', 'qa sme cleanup', { apply, tally });
    console.log(JSON.stringify({ report: 'qa-sme-cleanup', apply, tally, smes: r }));
  } else if (job === 'qa-template-cleanup') {
    if (config.appEnv === 'production') throw new Error('qa-template-cleanup refuses to run with APP_ENV=production');
    const args = process.argv.slice(3);
    const keep: string[] = [];
    let apply = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--apply') apply = true;
      else if (args[i] === '--keep' && /^[0-9a-f-]{36}$/i.test(args[i + 1] ?? '')) keep.push(args[++i]!);
      else throw new Error(`Unknown qa-template-cleanup argument "${args[i]}". Use: --keep <templateId> (repeat) [--apply]`);
    }
    if (apply && process.env.QA_TEMPLATE_CLEANUP_CONFIRM !== 'delete-other-templates') throw new Error('qa-template-cleanup --apply needs QA_TEMPLATE_CLEANUP_CONFIRM=delete-other-templates');
    const { cleanupTemplates } = await import('./qa-template-cleanup');
    const r = await cleanupTemplates(db, { keep, apply, log: (m, extra) => log('info', m, extra) });
    const tally = r.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.outcome]: (acc[o.outcome] ?? 0) + 1 }), {});
    log('info', 'qa template cleanup', { apply, tally });
    console.log(JSON.stringify({ report: 'qa-template-cleanup', apply, keep, tally, templates: r }));
  } else if (job === 'case-selector-slots') {
    const rest = process.argv.slice(3);
    const apply = rest.includes('--apply');
    const ids = rest.filter((a) => a !== '--apply');
    if (ids.length !== 1 || !/^[0-9a-f-]{36}$/i.test(ids[0]!)) throw new Error('Use: case-selector-slots <projectId> [--apply]');
    const { rebuildCaseSelectorSlots } = await import('./case-selector-slots');
    const r = await rebuildCaseSelectorSlots(db, { projectId: ids[0]!, apply });
    console.log(JSON.stringify({ report: 'case-selector-slots', apply, ...r }));
    if (r.outcome === 'refused') process.exitCode = 3;
  } else if (job === 'catalog-import') {
    const { parseCatalogImportArgs, runCatalogImport } = await import('./catalog-import');
    await runCatalogImport(db, parseCatalogImportArgs(process.argv.slice(3)), log);
  } else {
    throw new Error(`Unknown job "${job}". Use: migrate | verify-chains | bundle-sweep | seed | demo-setup | catalog-v2 | catalog-import | policy-seed | qa-users | qa-smoke | qa-seed-projects | qa-project-cleanup | qa-sme-cleanup | qa-template-cleanup | case-selector-slots`);
  }
} catch (err) {
  log('error', 'job failed', { err: String(err), alert: true });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
