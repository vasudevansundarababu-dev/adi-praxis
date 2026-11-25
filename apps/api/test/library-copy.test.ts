import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { copyLibrary } from '../src/jobs/library-copy';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1 (coordinator, 25 Nov 2026; precedent: the v8 successor job): copy a project's published rule set into
 * another project. The documents its rules cite are copied byte for byte; each rule arrives as a DRAFT with its quotes
 * re-linked to the copy. No approval is carried across: the PM reviews them again in the new project. Dry run first,
 * audited, idempotent; the source project is never changed. Synthetic text only.
 */
const POLICY = ['Synthetic federal KYC policy', 'Each customer must give a taxpayer identification number.', 'The bank must verify the residential address.'].join('\n');
const BASE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: null, to: null, conditionText: 'always' }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [] };

let app: FastifyInstance;
let storage: MemoryStorage;
let clientId: string;
let adminEmail: string;
let cookie: string;
let from: string;
let to: string;
const api = () => ({
  post: (url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
});

beforeAll(async () => {
  storage = new MemoryStorage();
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  clientId = (await createClient()).id;
  const admin = await createUser(clientId, ['ADMIN']);
  adminEmail = admin.email;
  cookie = await login(app, admin.email);
  const domain = await db.domain.create({ data: { clientId, name: 'Banking' } });
  const template = await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: 'KYC' } });
  from = (await db.project.create({ data: { clientId, ownerId: admin.id, templateId: template.id, templateVersion: 1, name: 'v8 project' } })).id;
  to = (await db.project.create({ data: { clientId, ownerId: admin.id, templateId: template.id, templateVersion: 1, name: 'KYC Judgment v1' } })).id;
  const d = await api().post(`/projects/${from}/policy/documents/text`, { title: 'Synthetic federal KYC policy', text: POLICY, format: 'txt', granularity: 'line', jurisdiction: 'US' });
  expect(d.statusCode, d.body).toBe(201);
  for (const [key, n] of [['TIN', 1], ['ADDRESS', 2]] as const) {
    const quote = POLICY.split('\n')[n]!;
    const r = await api().post(`/projects/${from}/policy/rules`, { documentVersionId: d.json().version.id, ruleKey: key, body: { ...BASE, title: key, requirement: quote }, citations: [{ fieldPath: 'requirement', role: 'supports', quote }] });
    expect(r.statusCode, r.body).toBe(201);
    expect((await api().put(`/projects/${from}/policy/rules/${r.json().ruleId}/applied`, { applied: true, expectedContentHash: r.json().contentHash })).statusCode).toBe(200);
  }
  expect((await api().post(`/projects/${from}/policy/rule-set`, { expectedLatestVersion: null })).statusCode).toBe(201);
});

const snapshot = async (projectId: string) => ({
  docs: await db.policyDocumentVersion.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
  versions: await db.policyRuleVersion.findMany({ where: { rule: { projectId } }, orderBy: { createdAt: 'asc' } }),
  sets: await db.projectRuleSet.findMany({ where: { projectId } }),
});

describe('copy a published rule set into another project (as drafts)', () => {
  it('dry run: says what it would copy and changes nothing', async () => {
    const before = [await snapshot(from), await snapshot(to)];
    const r = await copyLibrary(db, { storage }, { fromProjectId: from, toProjectId: to, requestedBy: adminEmail, apply: false });
    expect(r).toMatchObject({ outcome: 'would_copy', ruleSetVersion: 1, documents: [{ title: 'Synthetic federal KYC policy', outcome: 'would_copy' }], rules: [{ ruleKey: 'R-ADDRESS', outcome: 'would_copy' }, { ruleKey: 'R-TIN', outcome: 'would_copy' }] });
    expect([await snapshot(from), await snapshot(to)]).toEqual(before);
  });

  it('apply: the document byte for byte, each rule a DRAFT with its quote re-linked; no approval carried; the source unchanged; a repeat copies nothing', async () => {
    const source = await snapshot(from);
    const r = await copyLibrary(db, { storage }, { fromProjectId: from, toProjectId: to, requestedBy: adminEmail, apply: true });
    expect(r.outcome).toBe('copied');
    const t = await snapshot(to);
    expect(t.docs.map((d) => d.sha256)).toEqual(source.docs.map((d) => d.sha256));
    expect(t.versions.map((v) => [v.state, v.reviewedAt, v.reviewedById, v.origin])).toEqual([['DRAFT', null, null, 'library_copy'], ['DRAFT', null, null, 'library_copy']]);
    const rules = await db.policyRule.findMany({ where: { projectId: to }, include: { versions: { include: { citations: true } } }, orderBy: { ruleKey: 'asc' } });
    expect(rules.map((x) => x.ruleKey)).toEqual(['R-ADDRESS', 'R-TIN']);
    for (const x of rules) {
      const c = x.versions[0]!.citations[0]!;
      expect([c.documentVersionId, c.resolution]).toEqual([t.docs[0]!.id, 'RESOLVED']);
    }
    expect(t.sets).toEqual([]);
    expect(await snapshot(from)).toEqual(source);
    expect(await db.auditEvent.count({ where: { action: 'policy.rule_copied_from_library' } })).toBe(2);
    const again = await copyLibrary(db, { storage }, { fromProjectId: from, toProjectId: to, requestedBy: adminEmail, apply: true });
    expect(again).toMatchObject({ outcome: 'already_copied', documents: [{ outcome: 'already_copied' }], rules: [{ outcome: 'already_copied' }, { outcome: 'already_copied' }] });
    expect((await snapshot(to)).versions).toHaveLength(2);
  });

  it('refuses: a requester who is not an Admin, the same project twice, a source with no published rule set', async () => {
    expect(await copyLibrary(db, { storage }, { fromProjectId: from, toProjectId: to, requestedBy: 'nobody@example.invalid', apply: true })).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('Admin') });
    expect(await copyLibrary(db, { storage }, { fromProjectId: from, toProjectId: from, requestedBy: adminEmail, apply: true })).toMatchObject({ outcome: 'refused' });
    expect(await copyLibrary(db, { storage }, { fromProjectId: to, toProjectId: from, requestedBy: adminEmail, apply: true })).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('no published rule set') });
  });
});
