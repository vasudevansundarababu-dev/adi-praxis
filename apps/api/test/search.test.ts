import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { lettersScore, SearchService } from '../src/search/service';
import type { EmbeddingProvider } from '../src/tasks/embeddings';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { buildApp } from '../src/app';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/** Console search bar (owner, 12 Nov 2026): a few letters find a record; longer queries also match by meaning. */
const TEMPLATE = {
  primaryWork: 'Assemble identity evidence.',
  verificationCriteria: 'Document checks.',
  humanGate: 'Approval remains with a human.',
  defaultTptMinutes: 90,
  skills: ['KYC'],
  taskModes: ['AUTHORING'],
};

/** Records every text sent to the embedding model, so the test can check that no personal details are sent. */
class RecordingEmbeddings implements EmbeddingProvider {
  readonly model = 'hashing-768';
  readonly sent: string[] = [];
  private readonly inner = new HashingEmbeddingProvider();
  embed(text: string) {
    this.sent.push(text);
    return this.inner.embed(text);
  }
}

describe('console search', () => {
  let app: FastifyInstance;
  let embeddings: RecordingEmbeddings;
  let admin: string;
  let pm: string;
  let otherPm: string;
  let templateId: string;

  beforeAll(async () => {
    embeddings = new RecordingEmbeddings();
    app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, embeddings });
  });
  beforeEach(async () => {
    await resetDb();
    embeddings.sent.length = 0;
    const { client } = await seed(db, { SEED_CLIENT_NAME: 'ADI-Labs', SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    const pmUser = await createUser(client.id, ['PM']);
    await db.user.update({ where: { id: pmUser.id }, data: { name: 'Priya Manager' } });
    pm = await login(app, pmUser.email);
    otherPm = await login(app, (await createUser(client.id, ['PM'])).email);
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    templateId = (await post(admin, '/templates', { domainId, workflowName: 'KYC onboarding and refresh', ...TEMPLATE })).json().id;
    await post(admin, `/templates/${templateId}/publish`);
    const t2 = (await post(admin, '/templates', { domainId, workflowName: 'Sanctions screening alerts', ...TEMPLATE, skills: ['Sanctions screening', 'AML'] })).json().id;
    await post(admin, `/templates/${t2}/publish`);
    for (const [name, description, tid] of [
      ['Q4 KYC refresh programme', 'Periodic review of retail customers', templateId],
      ['Corporate onboarding pilot', 'Beneficial ownership checks for companies', templateId],
      ['Sanctions alert triage', 'Screening hits against watch lists', t2],
    ] as const) {
      expect((await post(pm, '/projects', { authoringExperience: 'BOTH', templateId: tid, name, description })).statusCode).toBe(201);
    }
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const post = (cookie: string, url: string, payload: unknown = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  const search = (cookie: string, type: string, q: string) => app.inject({ method: 'GET', url: `/api/v1/search/${type}?q=${encodeURIComponent(q)}`, headers: { cookie } });
  const titles = (res: { json(): { items: { title: string }[] } }) => res.json().items.map((i) => i.title);

  it('two or three letters find a project by name (prefix of any word), without calling the embedding model', async () => {
    const res = await search(pm, 'projects', 'q4');
    expect(res.statusCode, res.body).toBe(200);
    expect(titles(res)).toEqual(['Q4 KYC refresh programme']);
    expect(res.json().semantic).toBe('short_query');
    // The name match ranks first; a project whose workflow is "KYC onboarding" follows.
    expect(titles(await search(pm, 'projects', 'onb'))[0]).toBe('Corporate onboarding pilot');
    // Under 4 characters, nothing goes to the embedding model.
    expect(embeddings.sent).toEqual([]);
    expect(titles(await search(pm, 'projects', 'kyc re'))).toContain('Q4 KYC refresh programme');
  });

  it('tolerates a typo', async () => {
    expect(titles(await search(pm, 'projects', 'sanctoins'))).toContain('Sanctions alert triage');
  });

  it('longer queries also match by meaning; ids list every match for the table filter', async () => {
    const res = await search(pm, 'projects', 'watch lists screening');
    expect(res.json().semantic).toBe('used');
    expect(res.json().items[0]).toMatchObject({ title: 'Sanctions alert triage', href: expect.stringMatching(/^\/projects\//) });
    expect(res.json().ids).toHaveLength(res.json().items.length);
  });

  it('only finds what the list already shows: another PM sees none of these projects', async () => {
    expect(titles(await search(otherPm, 'projects', 'q4'))).toEqual([]);
    expect(titles(await search(admin, 'projects', 'q4'))).toEqual(['Q4 KYC refresh programme']);
    // Users is an Admin list.
    expect((await search(pm, 'users', 'pri')).statusCode).toBe(403);
    expect(titles(await search(admin, 'users', 'pri'))).toEqual(['Priya Manager']);
  });

  it('templates are searchable by skills, and edits are picked up on the next search', async () => {
    expect(titles(await search(pm, 'templates', 'aml'))).toEqual(['Sanctions screening alerts']);
    const p = await db.project.findFirstOrThrow({ where: { name: 'Corporate onboarding pilot' } });
    await db.project.update({ where: { id: p.id }, data: { name: 'Corporate KYB pilot' } });
    expect(titles(await search(pm, 'projects', 'kyb'))).toEqual(['Corporate KYB pilot']);
  });

  it('never sends names or emails to the embedding model', async () => {
    await search(admin, 'users', 'priya manager');
    await search(pm, 'projects', 'beneficial ownership');
    expect(embeddings.sent.join(' ')).not.toMatch(/Priya|@/);
  });

  it('falls back to letters when the embedding model fails', async () => {
    const failing: EmbeddingProvider = { model: 'down', embed: () => Promise.reject(new Error('quota')) };
    const s = new SearchService(db, failing);
    const actor = { userId: (await db.user.findFirstOrThrow({ where: { email: 'admin@test.local' } })).id, clientId: (await db.client.findFirstOrThrow()).id, roles: ['ADMIN'] } as never;
    const r = await s.search(actor, 'projects', 'refresh programme');
    expect(r.semantic).toBe('unavailable');
    expect(r.items.map((i) => i.title)).toEqual(['Q4 KYC refresh programme']);
  });

  it('letters score: title prefix, word prefixes, substring, then trigram', () => {
    const row = { title: 'KYC onboarding and refresh', text: 'KYC onboarding and refresh · Banking · EDD' };
    expect(lettersScore('kyc', row, 0)).toBe(1);
    expect(lettersScore('onb ref', row, 0)).toBe(0.95);
    expect(lettersScore('banking', row, 0)).toBe(0.85);
    // Fuzzy matches only from 5 characters.
    expect(lettersScore('kyb', row, 0.5)).toBe(0);
    expect(lettersScore('onbaording', row, 0.6)).toBe(0.6);
  });
});
