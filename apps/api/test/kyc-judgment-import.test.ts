import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { checkJointProposal } from '../src/anvil/joint-template';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1 (C4 at Studio e14116d): the template arrives the way v8 did, as a joint proposal, and is a new
 * workflow (not a v8 successor). Its rules come from the policy library (C1) through its fact bindings, so it carries no
 * template-level federal policies. Mocks only.
 */
const PROPOSAL = JSON.parse(readFileSync(new URL('./fixtures/kyc-judgment/kyc-judgment-v1.proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
// Studio e14116d: all six form changes are in; the proposal is used exactly as Studio's builder makes it.

describe('KYC Judgment v1 template import', () => {
  let app: FastifyInstance;
  let admin: string;
  let anvilKey: string;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() }), db, pingRedis: async () => true, selectionGate: stubSelectionGate });
  });
  beforeEach(async () => {
    await resetDb();
    await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    anvilKey = (await app.inject({ method: 'POST', url: '/api/v1/api-clients', headers: { cookie: admin, ...idem() }, payload: { name: 'Studio QA', kind: 'ANVIL' } })).json().key;
  });
  afterAll(async () => {
    await app.close();
  });

  it('a library-based v2 template (fact bindings, no federal policies) is accepted as a new workflow with its covered-types selector', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: structuredClone(PROPOSAL) });
    expect(res.statusCode, res.body).toBe(201);
    const t = await db.template.findUniqueOrThrow({ where: { id: res.json().data.template_version_id } });
    expect(t).toMatchObject({ workflowName: 'KYC Judgment v1', version: 1, status: 'DRAFT' });
    expect(t.caseSelector).toMatchObject({ source: 'S1.coveredApplicationTypes', strategy: 'stratified', values: ['individual', 'adult_joint', 'teen_joint', 'custodial'] });
    expect(t.defaultDistinctTarget).toBe(1);
  });

  it('a v2 template without fact bindings still needs its federal policies; any it sends must be valid', () => {
    const noBindings = structuredClone(PROPOSAL);
    delete noBindings.execution.policy_bindings;
    expect(checkJointProposal(noBindings).issues.map((i) => i.pointer)).toContain('/execution/federalPolicies');
    const bad = structuredClone(PROPOSAL);
    bad.execution.federalPolicies = [{ id: 'x' }];
    expect(checkJointProposal(bad).issues.map((i) => i.pointer)).toContain('/execution/federalPolicies/0');
    expect(checkJointProposal(structuredClone(PROPOSAL)).issues.filter((i) => i.pointer.startsWith('/execution/federalPolicies'))).toEqual([]);
  });
});
