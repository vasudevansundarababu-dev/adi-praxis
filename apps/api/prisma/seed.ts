import { PrismaClient, type Prisma } from '@prisma/client';
import { SEED_DEMOGRAPHIC_ATTRIBUTES } from '@praxis/shared';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hashPassword } from '../src/auth/password';
import { seedTerms, type ApprovedTermsText } from '../src/candidate/onboarding-service';
import { TERMS_KEYS } from '@praxis/shared';
import { importTaskflow, readTaskflow, type ImportResult } from '../src/templates/taskflow-import';
import { seedCatalogV2, type CatalogPlan } from './catalog/catalog-v2';

export { seedCatalogV2 };

/**
 * Local/staging seed (synthetic data only). Safe to run repeatedly.
 * - the single v1 client
 * - the first Admin user (credentials from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
 * - FLOW 4 failure reason codes (SPEC: "seeded, Admin-editable")
 * - the demographic taxonomy: SPEC's 8 attributes with standard value lists (ISO 3166, ISO 639, CEFR, ISCED, IANA)
 * - the template catalog from docs/Taskflow.xlsx (or TASKFLOW_PATH), all as drafts, then the Meta-Compiler catalog
 *   (seedCatalogV2, PRD D15): Digital Marketing and the 12 mockup Banking workflows, with the full blueprints published.
 *   Old-catalog workflows are retired by the `catalog-v2` job (D15a).
 * - the owner's approved contributor terms from prisma/seed-data/terms (published 15 Nov 2026); create-only, never
 *   overwriting an Admin's later version. A key with no file there falls back to placeholder text, which production
 *   refuses for onboarding
 */
export const APPROVED_TERMS_DIR = path.resolve(import.meta.dirname, 'seed-data/terms');

/** The approved terms texts kept in the repo, one `<key>.json` ({ title, body }) per terms document. */
export function readApprovedTerms(dir = APPROVED_TERMS_DIR): Partial<Record<(typeof TERMS_KEYS)[number], ApprovedTermsText>> {
  const out: Partial<Record<(typeof TERMS_KEYS)[number], ApprovedTermsText>> = {};
  for (const key of TERMS_KEYS) {
    const file = path.join(dir, `${key}.json`);
    if (!existsSync(file)) continue;
    const { title, body } = JSON.parse(readFileSync(file, 'utf8')) as ApprovedTermsText;
    if (typeof title !== 'string' || typeof body !== 'string' || !title.trim() || body.trim().length < 20) throw new Error(`Bad approved terms file: ${file}`);
    out[key] = { title, body };
  }
  return out;
}

export const DEFAULT_TASKFLOW_PATH = path.resolve(import.meta.dirname, '../../../docs/Taskflow.xlsx');

export const FAILURE_REASON_CODES = [
  ['WRONG_ANSWER', 'Wrong answer'],
  ['UNSUPPORTED_CLAIM', 'Unsupported claim'],
  ['POLICY_BREACH', 'Policy breach'],
  ['UNSAFE_ACTION', 'Unsafe action'],
  ['INCOMPLETE', 'Incomplete'],
  ['TOOL_MISUSE', 'Tool misuse'],
  ['OTHER', 'Other'],
] as const;

export async function seed(db: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  const clientName = env.SEED_CLIENT_NAME || 'ADI-Labs';
  const adminEmail = (env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = env.SEED_ADMIN_PASSWORD || '';
  if (!adminEmail || adminPassword.length < 12) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 12 characters) to seed the first Admin');
  }

  const client = await db.client.upsert({ where: { name: clientName }, update: {}, create: { name: clientName } });

  const admin = await db.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      clientId: client.id,
      email: adminEmail,
      name: 'Platform Admin',
      roles: ['ADMIN'],
      passwordHash: await hashPassword(adminPassword),
    },
  });

  for (const [code, label] of FAILURE_REASON_CODES) {
    await db.failureReasonCode.upsert({
      where: { clientId_code: { clientId: client.id, code } },
      update: {},
      create: { clientId: client.id, code, label },
    });
  }

  // Create-only: an Admin's later edits to an attribute are never overwritten.
  for (const a of SEED_DEMOGRAPHIC_ATTRIBUTES) {
    await db.demographicAttribute.upsert({
      where: { clientId_key: { clientId: client.id, key: a.key } },
      update: {},
      create: { clientId: client.id, key: a.key, label: a.label, type: a.type, allowedValues: a.allowedValues as Prisma.InputJsonValue },
    });
  }

  await seedTerms(db, client.id, admin.id, env.SEED_TERMS_DIR === 'none' ? {} : readApprovedTerms(env.SEED_TERMS_DIR || APPROVED_TERMS_DIR));

  const taskflowPath = env.TASKFLOW_PATH || DEFAULT_TASKFLOW_PATH;
  let templates: ImportResult | null = null;
  let catalog: CatalogPlan | null = null;
  if (existsSync(taskflowPath)) {
    templates = await importTaskflow(db, client.id, await readTaskflow(taskflowPath));
    catalog = await seedCatalogV2(db, client.id);
  }

  return { client, admin, templates, catalog, taskflowPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = new PrismaClient();
  seed(db)
    .then(({ client, admin, templates, catalog, taskflowPath }) => {
      console.log(`Seeded client "${client.name}" and admin ${admin.email}`);
      if (!templates) console.log(`Template catalog skipped: ${taskflowPath} not found`);
      else
        console.log(
          `Templates from ${path.basename(taskflowPath)}: ${templates.templatesCreated.length} created, ` +
            `${templates.templatesSkipped.length} already present; domains created: ${templates.domainsCreated.join(', ') || 'none'}`,
        );
      if (catalog) console.log(`Meta-Compiler catalog: ${catalog.changes.length} change(s)`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
