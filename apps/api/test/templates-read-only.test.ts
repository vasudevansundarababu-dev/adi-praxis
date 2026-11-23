import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { templateEditClosed } from '../src/templates/read-only';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/** D-024 (owner, 23 Nov 2026): templates come only from Studio releases; Authoring views, publishes and retires them. */
let app: FastifyInstance;
let admin: string;
let clientId: string;
const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) => app.inject({ method, url: `/api/v1${url}`, headers: { cookie: admin, ...(method === 'GET' ? {} : idem()) }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  app = await buildApp({ config: testConfig({ TEMPLATE_EDITING_ENABLED: 'false' }), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage: new MemoryStorage() });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  clientId = (await createClient()).id;
  admin = await login(app, (await createUser(clientId, ['ADMIN'])).email);
});

describe('templates are read-only in Authoring', () => {
  it('the editor and builder routes are closed on the server; viewing, Publish and Studio’s proposals are not', async () => {
    const domain = await db.domain.create({ data: { clientId, name: 'Banking' } });
    const draft = await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: 'KYC onboarding and refresh', status: 'DRAFT', primaryWork: 'KYC.', verificationCriteria: 'Checked.', humanGate: 'A person decides.', defaultTptMinutes: 60, skills: ['KYC'], taskModes: ['AUTHORING'] } });
    const refused = [
      await call('POST', '/templates', { domainId: domain.id, workflowName: 'X' }),
      await call('PATCH', `/templates/${draft.id}`, { primaryWork: 'Changed.' }),
      await call('POST', `/templates/${draft.id}/versions`),
      await call('PUT', `/templates/${draft.id}/blueprint`, {}),
      await call('POST', '/template-profiles', {}),
    ];
    for (const r of refused) {
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json()).toMatchObject({ error: 'TEMPLATES_READ_ONLY', message: expect.stringContaining('Templates come from Studio releases') });
    }
    expect((await db.template.findUniqueOrThrow({ where: { id: draft.id } })).primaryWork).toBe('KYC.');
    expect((await call('GET', `/templates/${draft.id}`)).statusCode).toBe(200);
    const pub = await call('POST', `/templates/${draft.id}/publish`);
    expect(pub.json().error).not.toBe('TEMPLATES_READ_ONLY');
    expect(pub.statusCode, pub.body).toBe(200);
  });

  it('only the listed writes are closed', () => {
    expect(templateEditClosed('POST', '/api/v1/templates/abc/publish')).toBe(false);
    expect(templateEditClosed('POST', '/api/v1/templates/abc/retire')).toBe(false);
    expect(templateEditClosed('POST', '/api/v1/integrations/anvil/templates/proposals')).toBe(false);
    expect(templateEditClosed('POST', '/api/v1/template-profiles/check')).toBe(false);
    expect(templateEditClosed('GET', '/api/v1/templates')).toBe(false);
    expect(templateEditClosed('PATCH', '/api/v1/templates/abc?x=1')).toBe(true);
  });
});
