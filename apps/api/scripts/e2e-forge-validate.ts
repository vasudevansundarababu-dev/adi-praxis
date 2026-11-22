import { sampleProfileOutput, WAVE1_PROFILES } from '@praxis/shared';
import { randomUUID } from 'node:crypto';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';

/**
 * Fixture for the multi-select validation UI test (e2e database only). In its own client, with the MVP1 new flow on so
 * the other UI tests keep the earlier journey, it builds a KYB project with two tasks, has one SME author both and the PM
 * approve both, through the real API in-process (mock Google sign-in). Prints { projectId, pm: { email, password } }.
 */
const url = process.env.E2E_DATABASE_URL ?? 'postgresql://praxis:praxis@localhost:5442/praxis_e2e';
if (!/e2e/.test(new URL(url).pathname)) throw new Error('e2e-forge-validate only runs against an e2e database');
const db = createDb(url);
const SECRET = 'e2e-forge-validate-secret';
const PASSWORD = 'e2e-forge-validate-password';
const tag = randomUUID().slice(0, 8);
const { client } = await seed(db, { SEED_CLIENT_NAME: 'E2E forge validate', SEED_ADMIN_EMAIL: 'admin.forge-validate@e2e.local', SEED_ADMIN_PASSWORD: PASSWORD, TASKFLOW_PATH: '/none' });
const pmEmail = `pm.forge-validate.${tag}@e2e.local`;
await db.user.create({ data: { clientId: client.id, email: pmEmail, name: 'Priya Menon', roles: ['PM'], passwordHash: await hashPassword(PASSWORD) } });

const google = new MockGoogleVerifier(SECRET);
const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: url, REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6389/7', LOGIN_RATE_LIMIT_PER_MINUTE: '1000' });
const app = await buildApp({ config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => client.id, storage: new MemoryStorage(), email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider() });

type Method = 'GET' | 'POST' | 'PUT';
async function call(cookie: string, method: Method, path: string, payload?: object, expected = [200, 201]) {
  const res = await app.inject({ method, url: `/api/v1${path}`, headers: { cookie, ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }) }, ...(payload ? { payload } : {}) });
  if (!expected.includes(res.statusCode)) throw new Error(`${method} ${path} → ${res.statusCode}: ${res.body}`);
  return res.json();
}
async function login(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`login ${email} → ${res.statusCode}: ${res.body}`);
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

try {
  const admin = await login('admin.forge-validate@e2e.local');
  const pm = await login(pmEmail);
  await call(admin, 'PUT', '/admin/forge-settings', { newFlow: true });

  const profile = WAVE1_PROFILES.find((p) => p.profileId === 'kyb-and-beneficial-ownership')!;
  const domain = await call(admin, 'POST', '/domains', { name: `Banking ${tag}` });
  const tpl = await call(admin, 'POST', '/templates', {
    domainId: domain.id,
    workflowName: profile.catalogWorkflowName,
    primaryWork: 'Author a realistic synthetic case with its reference solution and rubric.',
    verificationCriteria: 'Evidence, reference and rubric are consistent.',
    humanGate: 'A reviewer approves every task; the agent only recommends.',
    defaultTptMinutes: 60,
    skills: ['KYC'],
    taskModes: ['AUTHORING'],
    openSlotShare: 0,
    coverageDimensions: { dimensions: [{ key: 'risk_level', label: 'Risk level', values: ['low', 'high'] }], cells: [{ tags: { risk_level: 'low' }, quota: 1, required: true }, { tags: { risk_level: 'high' }, quota: 1, required: true }] },
    edgeCaseCatalog: [],
  });
  await call(admin, 'POST', `/templates/${tpl.id}/publish`);
  const jd = await call(pm, 'POST', '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' });
  const project = await call(pm, 'POST', '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: tpl.id, name: `SYNTHETIC TEST — multi-select validate ${tag}`, taskMode: 'AUTHORING', distinctTarget: 2, maxPerExpert: 2, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
  await db.project.update({ where: { id: project.id }, data: { authoringExperience: null } });
  await call(pm, 'POST', `/projects/${project.id}/submit`);
  const tasks = await db.taskInstance.findMany({ where: { projectId: project.id }, orderBy: { slot: { position: 'asc' } } });

  // One SME authors both tasks (mock Google sign-in, current terms accepted).
  const mail = `author-${tag}@gmail.test`;
  const signed = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `mock-${mail}`, email: mail, name: 'Ada Author' }), adultAttested: true } });
  if (signed.statusCode !== 200) throw new Error(`google sign-in → ${signed.statusCode}: ${signed.body}`);
  const author = `praxis_candidate=${signed.cookies.find((c) => c.name === 'praxis_candidate')!.value}`;
  const terms = await call(author, 'GET', '/me/forge/terms');
  await call(author, 'POST', '/me/forge/terms', { hashes: Object.fromEntries((terms.terms as { key: string; sha256: string }[]).map((t) => [t.key, t.sha256])), syntheticOnly: true });
  const person = await call(pm, 'POST', '/sourcing/people', { projectId: project.id, role: 'SME', firstName: 'Ada', lastName: 'Author', email: mail });
  for (const t of tasks) await call(pm, 'POST', `/projects/${project.id}/assignments/direct`, { sourcedPersonId: person.id, taskId: t.id });

  const allTrue = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };
  for (const [i, t] of tasks.entries()) {
    const v = await call(author, 'GET', `/me/tasks/${t.id}`);
    await call(author, 'PUT', `/me/tasks/${t.id}`, { output: sampleProfileOutput(profile), activeSecondsDelta: 10, expectedRevision: v.revision });
    await call(author, 'POST', `/me/tasks/${t.id}/submit`, { expectedRevision: (await call(author, 'GET', `/me/tasks/${t.id}`)).revision, syntheticDeclaration: true, flagExplanations: {} });
    const d = await call(pm, 'GET', `/projects/${project.id}/forge-tasks/${t.id}`);
    // Both tasks carry the same sample content: the second is a likely duplicate the reviewer accepts as distinct.
    await call(pm, 'POST', `/projects/${project.id}/tasks/${t.id}/decision`, { expectedVersion: d.expectedVersion, expectedRevision: d.expectedRevision, decision: 'APPROVE', checklist: allTrue, ...(i ? { duplicateDecision: 'ACCEPT_AS_DISTINCT' } : {}) });
  }
  const state = await call(pm, 'GET', `/projects/${project.id}/export`);
  if (state.tasks.length !== 2) throw new Error(`fixture project not ready: ${JSON.stringify(state)}`);
  console.log(JSON.stringify({ projectId: project.id, pm: { email: pmEmail, password: PASSWORD } }));
} finally {
  await app.close();
  await db.$disconnect();
}
