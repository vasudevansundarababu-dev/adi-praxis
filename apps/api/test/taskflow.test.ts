import { CoverageDimensions, EdgeCaseCatalog } from '@praxis/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TASKFLOW_PATH, seed } from '../prisma/seed';
import {
  importTaskflow,
  KYC_WORKFLOW,
  parseTaskflowRows,
  readTaskflow,
  type TaskflowRow,
} from '../src/templates/taskflow-import';
import { createClient, db, resetDb } from './helpers';

describe('Taskflow.xlsx parsing (docs/Taskflow.xlsx)', () => {
  let rows: TaskflowRow[];
  beforeAll(async () => {
    rows = await readTaskflow(DEFAULT_TASKFLOW_PATH);
  });
  const inDomain = (d: string) => rows.filter((r) => r.domain === d).map((r) => r.workflowName);

  it('imports every workflow row, grouped under the SPEC seed-catalog domains', () => {
    expect([...new Set(rows.map((r) => r.domain))]).toEqual(['Banking', 'Healthcare', 'Marketing', 'Research Assistant']);
    expect(inDomain('Banking')).toHaveLength(24);
    expect(inDomain('Banking')[0]).toBe('KYC onboarding and refresh');
    expect(inDomain('Banking').at(-1)).toBe('Country-specific interpretation');
    expect(inDomain('Healthcare')).toEqual(['Patient Doctor Agent']);
    expect(inDomain('Marketing')).toEqual(['SEO', 'Branding', 'Shopping Assistant', 'Voice Shopping Assistant']);
    expect(inDomain('Research Assistant')).toEqual(['Finance', 'Legal', 'Marketing', 'M & A']);
    expect(rows).toHaveLength(33);
  });

  it('keeps the three Banking description columns verbatim', () => {
    const kyc = rows.find((r) => r.workflowName === KYC_WORKFLOW)!;
    expect(kyc).toEqual({
      domain: 'Banking',
      workflowName: 'KYC onboarding and refresh',
      primaryWork: 'Assemble identity evidence, reconcile fields, detect gaps, recommend risk-based disposition.',
      verificationCriteria: 'Document/data checks, completeness, policy adherence, reviewer agreement.',
      humanGate: 'Approval, rejection and high-risk classification remain authorized decisions.',
    });
    // Non-ASCII punctuation survives (en dash in the workflow name).
    expect(inDomain('Banking')).toContain('Fraud–risk/compliance handoffs');
    for (const r of rows.filter((x) => x.domain === 'Banking')) {
      expect(r.primaryWork && r.verificationCriteria && r.humanGate, r.workflowName).toBeTruthy();
    }
  });

  it('name-only workflows have no descriptions', () => {
    for (const r of rows.filter((x) => x.domain !== 'Banking')) {
      expect([r.primaryWork, r.verificationCriteria, r.humanGate]).toEqual([null, null, null]);
    }
  });

  it('fixes the sheet typo "Researh Assistant" to SPEC’s "Research Assistant"', () => {
    const parsed = parseTaskflowRows([
      ['Banking', 'Workflow', 'Primary agent work', 'Verification / reward', 'Human gate'],
      ['Researh Assistant', '', '', '', ''],
      ['', 'Finance', '', '', ''],
    ]);
    expect(parsed[0]!.domain).toBe('Research Assistant');
  });

  it('rejects a sheet whose columns have changed', () => {
    expect(() =>
      parseTaskflowRows([
        ['Banking', 'Workflow', 'Primary work', 'Verification', 'Gate'],
        ['', 'KYC', 'a', 'b', 'c'],
      ]),
    ).toThrow(/Unexpected Taskflow headers/);
  });

  it('rejects data before the header row', () => {
    expect(() => parseTaskflowRows([['Banking', 'KYC', '', '', '']])).toThrow(/header row/);
  });
});

describe('Taskflow import into the catalog', () => {
  let clientId: string;
  let rows: TaskflowRow[];

  beforeAll(async () => {
    rows = await readTaskflow(DEFAULT_TASKFLOW_PATH);
  });
  beforeEach(async () => {
    await resetDb();
    clientId = (await createClient()).id;
  });
  afterAll(() => db.$disconnect());

  it('creates every domain and template as DRAFT version 1, each its own workflow, and audits them', async () => {
    const res = await importTaskflow(db, clientId, rows);
    expect(res.domainsCreated).toEqual(['Banking', 'Healthcare', 'Marketing', 'Research Assistant']);
    expect(res.templatesCreated).toHaveLength(33);

    const templates = await db.template.findMany({ where: { clientId } });
    expect(templates).toHaveLength(33);
    expect(new Set(templates.map((t) => t.status))).toEqual(new Set(['DRAFT']));
    expect(new Set(templates.map((t) => t.version))).toEqual(new Set([1]));
    expect(new Set(templates.map((t) => t.lineageId)).size).toBe(33);

    const audits = await db.auditEvent.findMany({ where: { clientId, actorType: 'SYSTEM' } });
    expect(audits.filter((a) => a.action === 'template.created')).toHaveLength(33);
    expect(audits.filter((a) => a.action === 'domain.created')).toHaveLength(4);
  });

  it('stores the Banking descriptions verbatim', async () => {
    await importTaskflow(db, clientId, rows);
    for (const r of rows.filter((x) => x.domain === 'Banking')) {
      const t = await db.template.findFirstOrThrow({ where: { clientId, workflowName: r.workflowName } });
      expect([t.primaryWork, t.verificationCriteria, t.humanGate]).toEqual([r.primaryWork, r.verificationCriteria, r.humanGate]);
    }
  });

  it('pre-fills KYC onboarding with SPEC’s coverage dimensions and all 10 edge cases, as valid data', async () => {
    await importTaskflow(db, clientId, rows);
    const kyc = await db.template.findFirstOrThrow({ where: { clientId, workflowName: KYC_WORKFLOW } });
    const matrix = CoverageDimensions.parse(kyc.coverageDimensions);
    expect(matrix.dimensions.map((d) => d.key)).toEqual(['customer_type', 'jurisdiction', 'risk_level', 'channel', 'document_type']);
    expect(matrix.dimensions.find((d) => d.key === 'customer_type')!.values).toEqual(['individual', 'sole trader', 'corporate', 'trust']);
    expect(matrix.dimensions.find((d) => d.key === 'jurisdiction')!.values).toEqual([]);
    const edges = EdgeCaseCatalog.parse(kyc.edgeCaseCatalog);
    expect(edges).toHaveLength(10);
    expect(edges.every((e) => e.quota === 1 && e.required)).toBe(true);
    expect(edges.map((e) => e.name)).toContain('Complex or circular ownership');

    // Other workflows get the empty defaults.
    const kyb = await db.template.findFirstOrThrow({ where: { clientId, workflowName: 'KYB and beneficial ownership' } });
    expect(kyb.edgeCaseCatalog).toEqual([]);
  });

  it('re-running creates nothing new and never overwrites an Admin’s edits', async () => {
    await importTaskflow(db, clientId, rows);
    const kyc = await db.template.findFirstOrThrow({ where: { clientId, workflowName: KYC_WORKFLOW } });
    await db.template.update({ where: { id: kyc.id }, data: { primaryWork: 'Edited by an Admin', defaultTptMinutes: 45 } });

    const again = await importTaskflow(db, clientId, rows);
    expect(again.templatesCreated).toEqual([]);
    expect(again.domainsCreated).toEqual([]);
    expect(again.templatesSkipped).toHaveLength(33);
    expect(await db.template.count({ where: { clientId } })).toBe(33);
    const after = await db.template.findUniqueOrThrow({ where: { id: kyc.id } });
    expect([after.primaryWork, after.defaultTptMinutes]).toEqual(['Edited by an Admin', 45]);
  });

  it('a re-run fills in only workflows that are missing', async () => {
    await importTaskflow(db, clientId, rows);
    await db.template.deleteMany({ where: { clientId, workflowName: 'SEO' } });
    const res = await importTaskflow(db, clientId, rows);
    expect(res.templatesCreated).toEqual(['Marketing / SEO']);
  });

  it('the seed script loads the catalog from docs/Taskflow.xlsx', async () => {
    const env = { SEED_CLIENT_NAME: 'Seed Catalog', SEED_ADMIN_EMAIL: 'admin@catalog.test', SEED_ADMIN_PASSWORD: 'seed-password-123' };
    const first = await seed(db, env);
    expect(first.templates?.templatesCreated).toHaveLength(33);
    const second = await seed(db, env);
    expect(second.templates?.templatesCreated).toEqual([]);
  });

  it('the seed skips the catalog when the file is missing', async () => {
    const res = await seed(db, {
      SEED_CLIENT_NAME: 'No Catalog',
      SEED_ADMIN_EMAIL: 'admin@nocatalog.test',
      SEED_ADMIN_PASSWORD: 'seed-password-123',
      TASKFLOW_PATH: '/nonexistent/Taskflow.xlsx',
    });
    expect(res.templates).toBeNull();
  });
});
