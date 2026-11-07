import { publishProblems } from '@praxis/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_V2, RETIRED_DOMAINS, loadCatalogBlueprint, normaliseName } from '../prisma/catalog';
import { CATALOG_V2_ACTOR, applyCatalogV2, reverseCatalogV2, type CatalogPlan } from '../prisma/catalog/catalog-v2';
import { DEFAULT_TASKFLOW_PATH, seed, seedCatalogV2 } from '../prisma/seed';
import { parseCatalogV2Args, runCatalogV2 } from '../src/jobs/catalog-v2';
import { importTaskflow, readTaskflow, type TaskflowRow } from '../src/templates/taskflow-import';
import { createClient, createUser, db, resetDb } from './helpers';

/** PRD D15a, part 2: the old-catalog Banking workflows that are retired. */
const D15A_BANKING = [
  'KYC onboarding and refresh',
  'Sanctions screening',
  'Suspicious activity and SAR/STR support',
  'Transaction investigation',
  'Regulatory change management',
  'Regulatory obligation mapping',
  'Policy-to-control mapping',
  'Model risk/compliance review',
  'Trade surveillance',
  'Third-party/vendor risk',
  'Operational risk events and RCSA',
  'Regulatory reporting validation',
];
const BLUEPRINT_WORKFLOWS = ['AML transaction-monitoring alerts', 'KYB and beneficial ownership', 'Launch of Noise Cancelling Phone'];
const PUBLISH_FIELDS = { primaryWork: 'Synthetic work', verificationCriteria: 'Checked', humanGate: 'Reviewer', defaultTptMinutes: 60, skills: ['KYC'], taskModes: ['AUTHORING' as const] };

let rows: TaskflowRow[];

beforeAll(async () => {
  await resetDb();
  rows = await readTaskflow(DEFAULT_TASKFLOW_PATH);
});

/** A client with today's Taskflow catalog, as in every existing environment. */
async function oldCatalogClient() {
  const c = await createClient();
  await importTaskflow(db, c.id, rows);
  return c.id;
}

const templatesOf = (clientId: string) =>
  db.template.findMany({ where: { clientId }, include: { domain: true }, orderBy: [{ domain: { name: 'asc' } }, { workflowName: 'asc' }, { version: 'asc' }] });
const domainsOf = (clientId: string) => db.domain.findMany({ where: { clientId }, orderBy: { name: 'asc' } });
const auditsOf = (clientId: string) => db.auditEvent.findMany({ where: { clientId, actorId: CATALOG_V2_ACTOR }, orderBy: { createdAt: 'asc' } });
const withoutIds = (p: CatalogPlan) => p.changes.map(({ entityId: _id, ...c }) => c);
const named = (p: CatalogPlan, action: string) => p.changes.filter((c) => c.action === action).map((c) => c.workflowName ?? c.domain).sort();

async function publish(clientId: string, workflowName: string) {
  const t = await db.template.findFirstOrThrow({ where: { clientId, workflowName } });
  return db.template.update({ where: { id: t.id }, data: { ...PUBLISH_FIELDS, status: 'PUBLISHED', publishedAt: new Date() } });
}

async function projectOn(clientId: string, templateId: string, version: number, status: 'DRAFT' | 'IN_PROGRESS' = 'IN_PROGRESS') {
  const owner = await createUser(clientId, ['PM']);
  return db.project.create({ data: { clientId, ownerId: owner.id, templateId, templateVersion: version, name: `Project ${templateId}`, status } });
}

/** What FLOW 1 offers a PM: the newest PUBLISHED version of each workflow in an active domain. */
async function offerable(clientId: string) {
  const ts = await templatesOf(clientId);
  return ts
    .filter((t) => t.status === 'PUBLISHED' && t.domain.status === 'ACTIVE' && !ts.some((o) => o.lineageId === t.lineageId && o.status === 'PUBLISHED' && o.version > t.version))
    .map((t) => t.workflowName)
    .sort();
}

describe('C6 catalog-v2 dry run (S1-16, D15, D15a)', () => {
  it('writes nothing and plans exactly the PRD change', async () => {
    const clientId = await oldCatalogClient();
    const before = { templates: await templatesOf(clientId), domains: await domainsOf(clientId), audits: await db.auditEvent.count({ where: { clientId } }) };

    const plan = await applyCatalogV2(db, clientId, { apply: false });

    expect(await templatesOf(clientId)).toEqual(before.templates);
    expect(await domainsOf(clientId)).toEqual(before.domains);
    expect(await db.auditEvent.count({ where: { clientId } })).toBe(before.audits);
    expect(plan.applied).toBe(false);

    // D15: Digital Marketing is new; the 12 mockup Banking workflows are reused, not duplicated.
    expect(named(plan, 'domain.created')).toEqual(['Digital Marketing']);
    expect(plan.changes.filter((c) => c.action === 'template.created').map((c) => [c.domain, c.workflowName, c.to])).toEqual([
      ['Digital Marketing', 'Launch of Noise Cancelling Phone', 'PUBLISHED'],
      ['Digital Marketing', 'Q4 Global Paid Search Query Clustering', 'DRAFT'],
      ['Digital Marketing', 'Omnichannel Creative & Locale Compliance', 'DRAFT'],
    ]);
    expect(plan.changes.filter((c) => c.action === 'template.published').map((c) => [c.domain, c.workflowName, c.from, c.to])).toEqual([
      ['Banking', 'AML transaction-monitoring alerts', 'DRAFT', 'PUBLISHED'],
      ['Banking', 'KYB and beneficial ownership', 'DRAFT', 'PUBLISHED'],
    ]);
    expect(plan.notes.filter((n) => n.kind === 'reused' && n.domain === 'Banking')).toHaveLength(10);

    // D15a: the three old domains and the 12 non-mockup Banking workflows are retired.
    expect(named(plan, 'domain.retired')).toEqual([...RETIRED_DOMAINS].sort());
    const retired = plan.changes.filter((c) => c.action === 'template.retired');
    expect(retired.filter((c) => c.domain === 'Banking').map((c) => c.workflowName).sort()).toEqual([...D15A_BANKING].sort());
    expect(retired.filter((c) => c.domain !== 'Banking').map((c) => `${c.domain} / ${c.workflowName}`).sort()).toEqual(
      rows.filter((r) => r.domain !== 'Banking').map((r) => `${r.domain} / ${r.workflowName}`).sort(),
    );
    expect(retired.every((c) => c.from === 'DRAFT' && c.to === 'RETIRED')).toBe(true);
    expect(plan.changes).toHaveLength(1 + 3 + 2 + 3 + 21);
  });
});

describe('C6 catalog-v2 apply', () => {
  let clientId: string;
  let dry: CatalogPlan;
  let applied: CatalogPlan;
  let oldIds: string[];

  beforeAll(async () => {
    clientId = await oldCatalogClient();
    oldIds = (await templatesOf(clientId)).map((t) => t.id);
    dry = await applyCatalogV2(db, clientId, { apply: false });
    applied = await applyCatalogV2(db, clientId, { apply: true });
  });

  it('applies exactly the dry-run plan', () => {
    expect(applied.applied).toBe(true);
    expect(withoutIds(applied)).toEqual(withoutIds(dry));
    expect(applied.changes.every((c) => c.entityId)).toBe(true);
  });

  it('leaves exactly the mockup catalog on Screen 1 and in new projects; nothing is deleted', async () => {
    const ts = await templatesOf(clientId);
    expect(ts.map((t) => t.id)).toEqual(expect.arrayContaining(oldIds));
    expect(ts).toHaveLength(oldIds.length + 3);
    expect((await domainsOf(clientId)).map((d) => [d.name, d.status])).toEqual([
      ['Banking', 'ACTIVE'],
      ['Digital Marketing', 'ACTIVE'],
      ['Healthcare', 'RETIRED'],
      ['Marketing', 'RETIRED'],
      ['Research Assistant', 'RETIRED'],
    ]);
    const live = ts.filter((t) => t.status !== 'RETIRED' && t.domain.status === 'ACTIVE');
    const expected = CATALOG_V2.flatMap((d) => d.workflows.map((w) => `${d.name} / ${normaliseName(w.workflowName)}`)).sort();
    expect(live.map((t) => `${t.domain.name} / ${normaliseName(t.workflowName)}`).sort()).toEqual(expected);
    expect(await offerable(clientId)).toEqual(BLUEPRINT_WORKFLOWS);
    expect(ts.filter((t) => D15A_BANKING.includes(t.workflowName)).every((t) => t.status === 'RETIRED' && t.retiredAt)).toBe(true);
  });

  it('reuses the Banking lineages by normalised name (en dash = hyphen)', async () => {
    const banking = (await templatesOf(clientId)).filter((t) => t.domain.name === 'Banking');
    expect(banking).toHaveLength(24);
    expect(new Set(banking.map((t) => t.lineageId)).size).toBe(24);
    expect(banking.map((t) => t.workflowName)).toContain('Fraud–risk/compliance handoffs');
    expect(banking.map((t) => t.workflowName)).not.toContain('Fraud-risk/compliance handoffs');
  });

  it('publishes the three full blueprints under the publish rules', async () => {
    for (const { name, file } of CATALOG_V2.flatMap((d) => d.workflows.filter((w) => w.blueprint).map((w) => ({ name: w.workflowName, file: w.blueprint! })))) {
      const t = (await templatesOf(clientId)).find((x) => x.workflowName === name)!;
      expect(t.status, name).toBe('PUBLISHED');
      expect(t.publishedAt).not.toBeNull();
      expect(t.blueprint).toEqual(JSON.parse(JSON.stringify(loadCatalogBlueprint(file))));
      expect(t.blueprintRevision).toBe(1);
      expect(t.executionMode).toBe(loadCatalogBlueprint(file).template_meta.modes[0]);
      expect(publishProblems(t)).toEqual([]);
    }
    const kyb = (await templatesOf(clientId)).find((t) => t.workflowName === 'KYB and beneficial ownership')!;
    expect(kyb.version).toBe(1);
    expect(kyb.primaryWork).toBe(loadCatalogBlueprint('kyb-and-beneficial-ownership.json').catalog.primary_work);
  });

  it('audits every change as SYSTEM:catalog-v2 with the previous status', async () => {
    const audits = await auditsOf(clientId);
    expect(audits).toHaveLength(applied.changes.length);
    for (const c of applied.changes) {
      const a = audits.find((e) => e.entityId === c.entityId && e.action === c.action)!;
      expect(a, `${c.action} ${c.workflowName ?? c.domain}`).toBeDefined();
      expect(a.actorType).toBe('SYSTEM');
      expect((a.after as { status: string }).status).toBe(c.to);
      expect((a.before as { status?: string } | null)?.status ?? null).toBe(c.from);
    }
    const kyb = audits.find((a) => a.action === 'template.published' && (a.after as { workflowName: string }).workflowName === 'KYB and beneficial ownership')!;
    expect((kyb.before as { fields: { primaryWork: string } }).fields.primaryWork).toBe(rows.find((r) => r.workflowName === 'KYB and beneficial ownership')!.primaryWork);
  });

  it('is idempotent: a second run and seedCatalogV2 change nothing', async () => {
    const before = await templatesOf(clientId);
    expect((await applyCatalogV2(db, clientId, { apply: true })).changes).toEqual([]);
    expect((await seedCatalogV2(db, clientId)).changes).toEqual([]);
    expect((await applyCatalogV2(db, clientId, { apply: false })).changes).toEqual([]);
    expect(await templatesOf(clientId)).toEqual(before);
    expect(await auditsOf(clientId)).toHaveLength(applied.changes.length);
  });
});

describe('C6 running projects are unaffected', () => {
  it('rows used by a project keep their state; unused rows are retired; project rows do not change', async () => {
    const clientId = await oldCatalogClient();
    const sanctions = await publish(clientId, 'Sanctions screening');
    const patient = await publish(clientId, 'Patient Doctor Agent');
    const kybV1 = await publish(clientId, 'KYB and beneficial ownership');
    const trade = await publish(clientId, 'Trade surveillance');
    const projects = [await projectOn(clientId, sanctions.id, 1), await projectOn(clientId, patient.id, 1, 'DRAFT'), await projectOn(clientId, kybV1.id, 1)];
    const projectsBefore = await db.project.findMany({ where: { clientId }, orderBy: { id: 'asc' } });

    const plan = await applyCatalogV2(db, clientId, { apply: true });

    expect(await db.project.findMany({ where: { clientId }, orderBy: { id: 'asc' } })).toEqual(projectsBefore);
    const byId = async (id: string) => (await db.template.findUniqueOrThrow({ where: { id } })).status;
    expect(await byId(sanctions.id)).toBe('PUBLISHED');
    expect(await byId(patient.id)).toBe('PUBLISHED');
    expect(await byId(kybV1.id)).toBe('PUBLISHED');
    expect(await byId(trade.id)).toBe('RETIRED');
    expect(plan.notes.filter((n) => n.kind === 'kept_used_by_project').map((n) => n.workflowName).sort()).toEqual(['Patient Doctor Agent', 'Sanctions screening']);
    expect(plan.changes.find((c) => c.entityId === trade.id)).toMatchObject({ action: 'template.retired', from: 'PUBLISHED', to: 'RETIRED' });

    // A published KYB without a blueprint gets a new version carrying it; the project keeps v1.
    const kyb = (await templatesOf(clientId)).filter((t) => t.lineageId === kybV1.lineageId);
    expect(kyb.map((t) => [t.version, t.status, t.blueprint !== null])).toEqual([
      [1, 'PUBLISHED', false],
      [2, 'PUBLISHED', true],
    ]);
    expect(plan.changes.find((c) => c.workflowName === 'KYB and beneficial ownership')).toMatchObject({ action: 'template.version_created', version: 2, to: 'PUBLISHED' });
    expect(projects.map((p) => p.templateVersion)).toEqual([1, 1, 1]);
    // The old Healthcare workflow is no longer offered: its domain is retired.
    expect(await offerable(clientId)).toEqual([...BLUEPRINT_WORKFLOWS, 'Sanctions screening'].sort());
  });

  it('reactivates a retired catalog domain and records its previous status', async () => {
    const clientId = await oldCatalogClient();
    await db.domain.updateMany({ where: { clientId, name: 'Banking' }, data: { status: 'RETIRED' } });
    const plan = await applyCatalogV2(db, clientId, { apply: true });
    expect(plan.changes.find((c) => c.action === 'domain.activated')).toMatchObject({ domain: 'Banking', from: 'RETIRED', to: 'ACTIVE' });
    expect((await domainsOf(clientId)).find((d) => d.name === 'Banking')!.status).toBe('ACTIVE');
  });

  it('leaves an Admin’s own blueprint draft and an Admin-retired catalog workflow alone', async () => {
    const clientId = await oldCatalogClient();
    const aml = await db.template.findFirstOrThrow({ where: { clientId, workflowName: 'AML transaction-monitoring alerts' } });
    const edited = { ...JSON.parse(JSON.stringify(loadCatalogBlueprint('aml-transaction-monitoring-alerts.json'))), studio_id: 'admin-edited-aml' };
    await db.template.update({ where: { id: aml.id }, data: { blueprint: edited } });
    const control = await db.template.findFirstOrThrow({ where: { clientId, workflowName: 'Control testing' } });
    await db.template.update({ where: { id: control.id }, data: { status: 'RETIRED', retiredAt: new Date() } });

    const plan = await applyCatalogV2(db, clientId, { apply: true });
    expect(await db.template.findUniqueOrThrow({ where: { id: aml.id } })).toMatchObject({ status: 'DRAFT', blueprint: edited });
    expect(plan.notes.find((n) => n.entityId === aml.id)).toMatchObject({ kind: 'blueprint_present' });
    expect((await db.template.findUniqueOrThrow({ where: { id: control.id } })).status).toBe('RETIRED');
    expect(plan.changes.some((c) => c.entityId === control.id)).toBe(false);
  });

  it('only touches the client it runs for', async () => {
    const a = await oldCatalogClient();
    const b = await oldCatalogClient();
    const bBefore = { t: await templatesOf(b), d: await domainsOf(b) };
    await applyCatalogV2(db, a, { apply: true });
    expect(await templatesOf(b)).toEqual(bBefore.t);
    expect(await domainsOf(b)).toEqual(bBefore.d);
  });
});

describe('C6 catalog-v2 --reverse', () => {
  it('restores the previous statuses, retires what it created, deletes nothing, and is idempotent', async () => {
    const clientId = await oldCatalogClient();
    const original = await templatesOf(clientId);
    const originalDomains = await domainsOf(clientId);
    const forward = await applyCatalogV2(db, clientId, { apply: true });
    const afterForward = await templatesOf(clientId);

    const dry = await reverseCatalogV2(db, clientId, { apply: false });
    expect(await templatesOf(clientId)).toEqual(afterForward);
    expect(dry.changes).toHaveLength(forward.changes.length);

    const reverse = await reverseCatalogV2(db, clientId, { apply: true });
    expect(withoutIds(reverse)).toEqual(withoutIds(dry));
    const restored = await templatesOf(clientId);
    expect(restored).toHaveLength(afterForward.length);
    for (const o of original) {
      const r = restored.find((t) => t.id === o.id)!;
      expect([r.workflowName, r.status, r.publishedAt, r.retiredAt]).toEqual([o.workflowName, o.status, o.publishedAt, o.retiredAt]);
    }
    expect(restored.filter((t) => t.domain.name === 'Digital Marketing').every((t) => t.status === 'RETIRED')).toBe(true);
    const domains = await domainsOf(clientId);
    for (const d of originalDomains) expect(domains.find((x) => x.id === d.id)!.status).toBe(d.status);
    expect(domains.find((d) => d.name === 'Digital Marketing')!.status).toBe('RETIRED');
    expect(await offerable(clientId)).toEqual([]);

    const reversals = (await auditsOf(clientId)).filter((a) => a.action === 'catalog_v2.reversed');
    expect(reversals).toHaveLength(forward.changes.length);
    expect(reversals.every((a) => a.actorType === 'SYSTEM' && (a.after as { reverses: string }).reverses)).toBe(true);
    expect((await reverseCatalogV2(db, clientId, { apply: true })).changes).toEqual([]);

    // Forward again after a reverse, then reverse again.
    const again = await applyCatalogV2(db, clientId, { apply: true });
    expect(named(again, 'domain.retired')).toEqual([...RETIRED_DOMAINS].sort());
    expect(again.changes.filter((c) => c.action === 'domain.activated').map((c) => c.domain)).toEqual(['Digital Marketing']);
    expect(await offerable(clientId)).toEqual(BLUEPRINT_WORKFLOWS);
    expect(again.changes.filter((c) => c.action === 'template.reinstated').map((c) => [c.workflowName, c.to])).toEqual([
      ['Launch of Noise Cancelling Phone', 'PUBLISHED'],
      ['Q4 Global Paid Search Query Clustering', 'DRAFT'],
      ['Omnichannel Creative & Locale Compliance', 'DRAFT'],
    ]);
    expect(named(again, 'template.published')).toEqual(['AML transaction-monitoring alerts', 'KYB and beneficial ownership']);
    expect((await templatesOf(clientId)).map((t) => [t.id, t.status])).toEqual(afterForward.map((t) => [t.id, t.status]));
    expect((await applyCatalogV2(db, clientId, { apply: true })).changes).toEqual([]);
    expect((await reverseCatalogV2(db, clientId, { apply: true })).changes).toHaveLength(again.changes.length);
    expect(await offerable(clientId)).toEqual([]);
  });

  it('keeps rows that a project started using after the run', async () => {
    const clientId = await oldCatalogClient();
    await applyCatalogV2(db, clientId, { apply: true });
    const launch = (await templatesOf(clientId)).find((t) => t.workflowName === 'Launch of Noise Cancelling Phone')!;
    await projectOn(clientId, launch.id, 1);
    const reverse = await reverseCatalogV2(db, clientId, { apply: true });
    expect((await db.template.findUniqueOrThrow({ where: { id: launch.id } })).status).toBe('PUBLISHED');
    expect(reverse.notes.find((n) => n.entityId === launch.id)).toMatchObject({ kind: 'reverse_skipped', status: 'PUBLISHED' });
  });

  it('skips rows whose status changed since the run', async () => {
    const clientId = await oldCatalogClient();
    await applyCatalogV2(db, clientId, { apply: true });
    const seo = (await templatesOf(clientId)).find((t) => t.workflowName === 'SEO')!;
    await db.template.update({ where: { id: seo.id }, data: { status: 'PUBLISHED' } });
    const reverse = await reverseCatalogV2(db, clientId, { apply: true });
    expect((await db.template.findUniqueOrThrow({ where: { id: seo.id } })).status).toBe('PUBLISHED');
    expect(reverse.notes.find((n) => n.entityId === seo.id)).toMatchObject({ kind: 'reverse_skipped' });
  });
});

describe('C6 seed and job entrypoint', () => {
  it('seed() adds the Meta-Compiler catalog for new environments and stays idempotent', async () => {
    const env = { SEED_CLIENT_NAME: 'Catalog V2 Seed', SEED_ADMIN_EMAIL: 'admin@catalog-v2.test', SEED_ADMIN_PASSWORD: 'seed-password-123' };
    const first = await seed(db, env);
    expect(first.catalog?.changes.map((c) => c.action).sort()).toEqual(['domain.created', 'template.created', 'template.created', 'template.created', 'template.published', 'template.published']);
    expect(await offerable(first.client.id)).toEqual(BLUEPRINT_WORKFLOWS);
    const second = await seed(db, env);
    expect(second.catalog?.changes).toEqual([]);
  });

  it('parses --dry-run, --reverse and --client, and refuses anything else', () => {
    expect(parseCatalogV2Args([])).toEqual({ dryRun: false, reverse: false, clientName: null });
    expect(parseCatalogV2Args(['--dry-run', '--reverse', '--client', 'ADI-Labs'])).toEqual({ dryRun: true, reverse: true, clientName: 'ADI-Labs' });
    expect(() => parseCatalogV2Args(['--apply'])).toThrow(/Unknown catalog-v2 argument/);
    expect(() => parseCatalogV2Args(['--client'])).toThrow(/Unknown catalog-v2 argument/);
  });

  it('runs the dry run, the apply and the reverse for the named client and logs the plan', async () => {
    const clientId = await oldCatalogClient();
    const name = (await db.client.findUniqueOrThrow({ where: { id: clientId } })).name;
    const logs: { message: string; extra?: object }[] = [];
    const log = (_level: string, message: string, extra?: object) => logs.push({ message, extra });

    const [dry] = await runCatalogV2(db, { dryRun: true, reverse: false, clientName: name }, log);
    expect(dry!.applied).toBe(false);
    expect(await auditsOf(clientId)).toEqual([]);
    expect(logs[0]!.message).toBe('catalog-v2 dry run: 30 change(s)');
    expect(logs[0]!.extra).toMatchObject({ client: name, counts: { 'template.retired': 21, 'domain.retired': 3, 'template.created': 3, 'template.published': 2, 'domain.created': 1 } });
    expect((logs[0]!.extra as { changes: string[] }).changes).toContain('template.retired Banking / Sanctions screening v1: DRAFT -> RETIRED');

    const [applied] = await runCatalogV2(db, { dryRun: false, reverse: false, clientName: name }, log);
    expect(withoutIds(applied!)).toEqual(withoutIds(dry!));
    const [reversed] = await runCatalogV2(db, { dryRun: false, reverse: true, clientName: name }, log);
    expect(reversed!.changes).toHaveLength(30);
    expect(logs.map((l) => l.message)).toEqual(['catalog-v2 dry run: 30 change(s)', 'catalog-v2: 30 change(s)', 'catalog-v2 reverse: 30 change(s)']);

    await expect(runCatalogV2(db, { dryRun: true, reverse: false, clientName: 'No such client' }, log)).rejects.toThrow(/not found/);
  });
});
