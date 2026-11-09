import type { Prisma } from '@prisma/client';
import { BLUEPRINT_SECTIONS, HarborBlueprint } from '@praxis/shared';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { sha256 } from '../lib/crypto';
import { blueprintHash, serverProblems } from '../meta-compiler/blueprint';
import { runJobCommand } from '../platform/command';
import { catalogColumns } from '../routes/meta-compiler';

/**
 * `run.ts catalog-import --file <abs-path> --client <clientId> [--dry-run]`: imports one private template (for
 * example the owner's case) as a DRAFT for one client, from a JSON file kept outside the repository. Validated with the
 * blueprint validators; saved through the job command path (idempotency, audit). Logs counts only, never content.
 */
export interface CatalogImportArgs {
  file: string;
  clientId: string;
  dryRun: boolean;
}

export function parseCatalogImportArgs(argv: string[]): CatalogImportArgs {
  let file = '';
  let clientId = '';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') dryRun = true;
    else if (a === '--file' && argv[i + 1]) file = argv[++i]!;
    else if (a === '--client' && argv[i + 1]) clientId = argv[++i]!;
    else throw new Error(`Unknown catalog-import argument "${a}". Use: --file <abs-path> --client <clientId> [--dry-run]`);
  }
  if (!file || !clientId) throw new Error('catalog-import needs --file <abs-path> and --client <clientId>');
  if (!z.string().uuid().safeParse(clientId).success) throw new Error('--client must be the client id (a UUID)');
  return { file, clientId, dryRun };
}

const ImportFile = z.object({
  template: z.object({
    domainName: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(20_000).optional(),
    tptMinutes: z.number().int().min(1).max(480).optional(),
  }),
  blueprint: z.unknown(),
});

export class CatalogImportError extends Error {
  constructor(message: string, readonly problems: string[] = []) {
    super(problems.length ? `${message}:\n- ${problems.join('\n- ')}` : message);
  }
}

export interface ImportSummary {
  dropzones: number;
  fixedDropzones: number;
  milestones: number;
  judgedMilestones: number;
  criteria: number;
  criteriaPoints: number;
}

export function importSummary(bp: HarborBlueprint): ImportSummary {
  const zones = bp.step_2_data_panels.public_dropzones;
  const ms = bp.step_5_default_rubric.milestones;
  const criteria = ms.flatMap((m) => m.judge?.criteria ?? []);
  return {
    dropzones: zones.length,
    fixedDropzones: zones.filter((z) => z.fixed_content !== null).length,
    milestones: ms.length,
    judgedMilestones: ms.filter((m) => m.judge).length,
    criteria: criteria.length,
    criteriaPoints: criteria.reduce((s, c) => s + c.points, 0),
  };
}

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/** The file must be absolute and must not live inside the repository checkout (private content never enters git). */
export async function readImportFile(file: string, repoRoot = REPO_ROOT): Promise<z.infer<typeof ImportFile> & { blueprint: HarborBlueprint }> {
  if (!path.isAbsolute(file)) throw new CatalogImportError('--file must be an absolute path');
  const real = await realpath(file).catch(() => {
    throw new CatalogImportError('The import file does not exist or cannot be read');
  });
  const root = await realpath(repoRoot);
  if (real === root || real.startsWith(root + path.sep)) throw new CatalogImportError('Refusing a file inside the repository checkout: keep private templates outside it');
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(real, 'utf8'));
  } catch {
    throw new CatalogImportError('The import file is not valid JSON');
  }
  const shape = ImportFile.safeParse(raw);
  if (!shape.success) throw new CatalogImportError('The import file has the wrong shape', shape.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  const bp = HarborBlueprint.safeParse(shape.data.blueprint);
  if (!bp.success) throw new CatalogImportError('The blueprint does not match the schema', bp.error.issues.map((i) => `blueprint.${i.path.join('.')}: ${i.message}`));
  return { template: shape.data.template, blueprint: bp.data };
}

/** The blueprint as saved: catalog naming and TPT from the file's template block; the description fills a blank objective. */
function prepared(bp: HarborBlueprint, t: z.infer<typeof ImportFile>['template'], version: number): HarborBlueprint {
  const out = structuredClone(bp);
  out.template_meta = { ...out.template_meta, label: t.name, domain_category: t.domainName, version, tpt_minutes: t.tptMinutes ?? out.template_meta.tpt_minutes };
  if (t.description && !out.domain_meta.objective.trim()) out.domain_meta.objective = t.description;
  return out;
}

async function locate(tx: Db | Tx, clientId: string, t: { domainName: string; name: string }) {
  const domain = await tx.domain.findFirst({ where: { clientId, name: { equals: t.domainName, mode: 'insensitive' } } });
  const latest = domain ? await tx.template.findFirst({ where: { clientId, domainId: domain.id, workflowName: { equals: t.name, mode: 'insensitive' } }, orderBy: { version: 'desc' } }) : null;
  return { domain, latest };
}

async function problemsFor(tx: Db | Tx, clientId: string, lineageId: string, bp: HarborBlueprint): Promise<string[]> {
  const p = await serverProblems(tx, { clientId, lineageId }, bp);
  return BLUEPRINT_SECTIONS.flatMap((s) => p[s].map((m) => `${s}: ${m}`));
}

type Log = (level: string, message: string, extra?: object) => void;
export type ImportAction = 'create' | 'new_version' | 'update' | 'unchanged';
export interface ImportResult {
  action: ImportAction;
  templateId: string | null;
  version: number;
  dryRun: boolean;
  replayed: boolean;
  summary: ImportSummary;
}

export async function runCatalogImport(db: Db, args: CatalogImportArgs, log: Log, repoRoot = REPO_ROOT): Promise<ImportResult> {
  const client = await db.client.findUnique({ where: { id: args.clientId } });
  if (!client) throw new CatalogImportError(`Client ${args.clientId} not found`);
  const { template, blueprint } = await readImportFile(args.file, repoRoot);
  const summary = importSummary(blueprint);
  const bpSha = blueprintHash(blueprint);

  const plan = async (tx: Db | Tx) => {
    const { domain, latest } = await locate(tx, client.id, template);
    const action: ImportAction = !latest ? 'create' : latest.status !== 'DRAFT' ? 'new_version' : latest.blueprint && blueprintHash(HarborBlueprint.parse(latest.blueprint)) === blueprintHash(prepared(blueprint, template, latest.version)) ? 'unchanged' : 'update';
    const version = !latest ? 1 : action === 'new_version' ? latest.version + 1 : latest.version;
    const lineageId = latest?.lineageId ?? randomUUID();
    const bp = prepared(blueprint, template, version);
    const problems = await problemsFor(tx, client.id, lineageId, bp);
    if (problems.length) throw new CatalogImportError('The blueprint is not complete', problems);
    return { domain, latest, action, version, lineageId, bp };
  };

  if (args.dryRun) {
    const p = await plan(db);
    const result: ImportResult = { action: p.action, templateId: p.latest?.id ?? null, version: p.version, dryRun: true, replayed: false, summary };
    log('info', `catalog-import dry run: would ${p.action.replace('_', ' ')}`, { clientId: client.id, ...result });
    return result;
  }

  const key = sha256(`${client.id}\n${template.domainName.toLowerCase()}\n${template.name.toLowerCase()}\n${bpSha}`);
  const request = { domainName: template.domainName, name: template.name, tptMinutes: template.tptMinutes ?? null, descriptionSha256: template.description ? sha256(template.description) : null, blueprintSha256: bpSha };
  const r = await runJobCommand<ImportResult>(db, { clientId: client.id, actorId: 'catalog-import', name: 'catalog-import', key, request }, async ({ tx, audit }) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-import:${client.id}:${template.domainName.toLowerCase()}:${template.name.toLowerCase()}`}))`;
    const p = await plan(tx);
    const after = { action: p.action, version: p.version, blueprintSha256: bpSha, ...summary };
    let domainId = p.domain?.id;
    if (!domainId) {
      domainId = (await tx.domain.create({ data: { clientId: client.id, name: template.domainName } })).id;
      await audit({ entityType: 'Domain', entityId: domainId, action: 'domain.created', after: { name: template.domainName, source: 'catalog-import' } });
    }
    const data = { ...catalogColumns(p.bp), blueprint: p.bp as unknown as Prisma.InputJsonValue };
    let templateId: string;
    if (p.action === 'unchanged') {
      templateId = p.latest!.id;
      await audit({ entityType: 'Template', entityId: templateId, action: 'template.import_unchanged', after });
    } else if (p.action === 'update') {
      templateId = p.latest!.id;
      const saved = await tx.template.update({ where: { id: templateId }, data: { ...data, blueprintRevision: { increment: 1 } } });
      await audit({ entityType: 'Template', entityId: templateId, action: 'template.blueprint_saved', before: { revision: p.latest!.blueprintRevision }, after: { ...after, revision: saved.blueprintRevision, source: 'catalog-import' } });
    } else {
      const created = await tx.template.create({
        data: { ...(data as Prisma.TemplateUncheckedCreateInput), clientId: client.id, domainId, lineageId: p.lineageId, version: p.version, workflowName: template.name, status: 'DRAFT', blueprintRevision: 0 },
      });
      templateId = created.id;
      await audit({ entityType: 'Template', entityId: templateId, action: 'template.imported', after });
    }
    return { status: 200, body: { action: p.action, templateId, version: p.version, dryRun: false, replayed: false, summary } };
  });
  const result = { ...(r.body as ImportResult), replayed: r.replayed };
  log('info', `catalog-import: ${result.action.replace('_', ' ')}${r.replayed ? ' (replayed)' : ''}`, { clientId: client.id, ...result });
  return result;
}
