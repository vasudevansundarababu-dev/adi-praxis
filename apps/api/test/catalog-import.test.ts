import { HarborBlueprint } from '@praxis/shared';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseCatalogImportArgs, REPO_ROOT, runCatalogImport } from '../src/jobs/catalog-import';
import { createClient, db, resetDb } from './helpers';
import { FIXED_EXHIBIT, judgedExampleBlueprint } from './judge-fixture';
import { jsonBody } from './meta-compiler-fixtures';

/** Synthetic import file (invented case, no real company data) written outside the repository. */
const dir = mkdtempSync(path.join(tmpdir(), 'praxis-import-'));
function importFile(blueprint: unknown = jsonBody(judgedExampleBlueprint('quietline-launch-memo')), template: object = { domainName: 'Synthetic Marketing', name: 'Quietline launch memo', description: 'Invented launch case.', tptMinutes: 60 }) {
  const f = path.join(dir, `${randomUUID()}.json`);
  writeFileSync(f, JSON.stringify({ template, blueprint }));
  return f;
}
const SECRETS = ['ANSWERKEY', 'You grade a launch memo', FIXED_EXHIBIT.trim(), 'Quietline launch budget'];

describe('J5 catalog-import job', () => {
  let clientId: string;
  let logs: unknown[];
  const log = (level: string, message: string, extra: object = {}) => void logs.push({ level, message, ...extra });
  const run = (file: string, dryRun = false, client = clientId) => runCatalogImport(db, { file, clientId: client, dryRun }, log);

  beforeEach(async () => {
    await resetDb();
    clientId = (await createClient()).id;
    logs = [];
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('parses its arguments', () => {
    expect(parseCatalogImportArgs(['--file', '/tmp/x.json', '--client', '00000000-0000-4000-8000-000000000001', '--dry-run'])).toEqual({ file: '/tmp/x.json', clientId: '00000000-0000-4000-8000-000000000001', dryRun: true });
    expect(() => parseCatalogImportArgs(['--file', '/tmp/x.json'])).toThrow(/needs --file/);
    expect(() => parseCatalogImportArgs(['--file', '/tmp/x.json', '--client', 'ADI-Labs'])).toThrow(/UUID/);
    expect(() => parseCatalogImportArgs(['--apply'])).toThrow(/Unknown catalog-import argument/);
  });

  it('refuses relative paths, files inside the repository and missing files', async () => {
    await expect(run('relative/file.json')).rejects.toThrow(/absolute/);
    await expect(run(path.join(REPO_ROOT, 'package.json'))).rejects.toThrow(/inside the repository/);
    await expect(run(path.join(dir, 'missing.json'))).rejects.toThrow(/does not exist/);
    await expect(run(importFile(), false, randomUUID())).rejects.toThrow(/not found/);
  });

  it('prints the validation problems and writes nothing for an invalid or incomplete blueprint', async () => {
    const bad = jsonBody(judgedExampleBlueprint('quietline-bad'));
    (bad.step_5_default_rubric as { milestones: { weight: unknown }[] }).milestones[0]!.weight = 'heavy';
    await expect(run(importFile(bad))).rejects.toThrow(/blueprint\.step_5_default_rubric\.milestones\.0\.weight/);
    const incomplete = judgedExampleBlueprint('quietline-incomplete');
    incomplete.step_5_default_rubric.milestones[2]!.judge!.criteria = [];
    await expect(run(importFile(jsonBody(incomplete)))).rejects.toThrow(/stage_5: Milestone "memo": add at least one judge criterion/);
    expect(await db.template.count()).toBe(0);
    expect(await db.auditEvent.count()).toBe(0);
  });

  it('--dry-run validates and prints counts only, and writes nothing', async () => {
    const r = await run(importFile(), true);
    expect(r).toMatchObject({ action: 'create', templateId: null, version: 1, dryRun: true, summary: { dropzones: 2, fixedDropzones: 1, milestones: 4, judgedMilestones: 2, criteria: 4, criteriaPoints: 10 } });
    expect(await db.template.count()).toBe(0);
    expect(await db.domain.count()).toBe(0);
    expect(await db.auditEvent.count()).toBe(0);
    const printed = JSON.stringify(logs);
    expect(printed).toMatch(/would create/);
    for (const s of SECRETS) expect(printed).not.toContain(s);
  });

  it('creates a client-scoped DRAFT with the blueprint, audited and idempotent; a changed blueprint updates it', async () => {
    const other = await createClient();
    const file = importFile();
    const first = await run(file);
    expect(first).toMatchObject({ action: 'create', version: 1, dryRun: false, replayed: false });
    const t = await db.template.findUniqueOrThrow({ where: { id: first.templateId! }, include: { domain: true } });
    expect(t).toMatchObject({ clientId, status: 'DRAFT', workflowName: 'Quietline launch memo', version: 1, blueprintRevision: 0, defaultTptMinutes: 60, executionMode: 'HERMETIC_MCP' });
    expect(t.domain).toMatchObject({ clientId, name: 'Synthetic Marketing' });
    const bp = HarborBlueprint.parse(t.blueprint);
    expect(bp.template_meta).toMatchObject({ label: 'Quietline launch memo', domain_category: 'Synthetic Marketing', tpt_minutes: 60 });
    expect(bp.step_2_data_panels.public_dropzones.find((z) => z.id === 'exhibit')!.fixed_content).toBe(FIXED_EXHIBIT);
    expect(bp.step_5_default_rubric.milestones.filter((m) => m.judge).map((m) => m.judge!.criteria.length)).toEqual([3, 1]);
    expect(await db.template.count({ where: { clientId: other.id } })).toBe(0);

    const audits = await db.auditEvent.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => [a.action, a.actorType, a.actorId])).toEqual([['domain.created', 'SYSTEM', 'catalog-import'], ['template.imported', 'SYSTEM', 'catalog-import']]);
    for (const s of SECRETS) expect(JSON.stringify(audits) + JSON.stringify(logs)).not.toContain(s);

    // Same file again: replayed from the idempotency record, nothing new written.
    const again = await run(file);
    expect(again).toMatchObject({ action: 'create', templateId: first.templateId, replayed: true });
    expect(await db.template.count()).toBe(1);
    expect(await db.auditEvent.count({ where: { clientId } })).toBe(2);

    // A changed blueprint updates the same draft and bumps its revision.
    const changed = judgedExampleBlueprint('quietline-launch-memo');
    changed.step_5_default_rubric.milestones[2]!.judge!.criteria[0]!.points = 5;
    const upd = await run(importFile(jsonBody(changed)));
    expect(upd).toMatchObject({ action: 'update', templateId: first.templateId, summary: { criteriaPoints: 13 } });
    expect((await db.template.findUniqueOrThrow({ where: { id: first.templateId! } })).blueprintRevision).toBe(1);
    expect(await db.auditEvent.count({ where: { clientId, action: 'template.blueprint_saved' } })).toBe(1);

    // Once published, an import of new content creates the next DRAFT version on the same lineage.
    await db.template.update({ where: { id: first.templateId! }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    changed.step_5_default_rubric.milestones[2]!.judge!.criteria[0]!.points = 6;
    const next = await run(importFile(jsonBody(changed)));
    expect(next).toMatchObject({ action: 'new_version', version: 2 });
    const v2 = await db.template.findUniqueOrThrow({ where: { id: next.templateId! } });
    expect(v2).toMatchObject({ status: 'DRAFT', version: 2, lineageId: t.lineageId });
  });

  it('refuses a Studio Blueprint ID already used by another workflow of the client', async () => {
    await run(importFile());
    await expect(run(importFile(jsonBody(judgedExampleBlueprint('quietline-launch-memo')), { domainName: 'Synthetic Marketing', name: 'Another workflow' }))).rejects.toThrow(/already used by another workflow/);
  });
});
