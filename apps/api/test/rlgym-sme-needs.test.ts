import type { ApprovedTaskRecord, Prisma, Template } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { jointHashes, jointTemplateSpec, type JointTemplateSpec } from '../src/anvil/joint-template';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { writeApprovedRecord } from '../src/dataset/approved-records';
import { loadKycV8Inputs, successorTemplate } from '../src/jobs/kyc-v8-successor';
import { applyBindings, KYC_V8_TOOL_BINDING } from '../src/jobs/kyc-v8-tool-binding';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';
import { fakeRlGym, fakeStudio, qualifyForRlGym, RLGYM_CONFIG, STUDIO_CONFIG } from './rlgym-helpers';

/**
 * New RL Gym part 4 (docs/design/FORGE-RLGYM-V2-DESIGN.md; AUTHORING-SNAPSHOT §3.3): an author sends a need to the PM
 * from the task page; Reviewers and the PM raise needs too; only the PM sends them to Studio's inbox (one item per
 * kind), rejects them or marks them resolved; a task with an open "new kind of case" need is held back from export.
 * Studio and the RL Gym are recorded fakes (mocks only).
 */
const SECRET = 'test-mock-secret';
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const EMBEDDED = loadKycV8Inputs();
const WORKFLOW = 'KYC onboarding and refresh';
const ADMIN_EMAIL = 'admin@test.local';
const REF = { id: 'tpl_x5rwt6d5eu', version: 9, spec: 'f'.repeat(64) };

/** The RL Gym's hash (anvil.rlgym.common.sha): sorted keys, compact JSON, UTF-8. */
function rlGymSha(value: unknown): string {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v);
  return createHash('sha256').update(JSON.stringify(sort(value)), 'utf8').digest('hex');
}

/** The embedded v8 candidate for an application type, with its APR-13 tool bindings (so every task can be packaged). */
function boundOutput(applicationType: string) {
  const c = [...EMBEDDED.successors.values()].find((s) => s.candidate.output.sections.S1!.applicationType === applicationType)!;
  const bt = KYC_V8_TOOL_BINDING.tasks.find((t) => t.applicationType === applicationType);
  if (!bt) return c.candidate.output;
  const r = applyBindings(c.candidate.output, bt.changes);
  if (!('output' in r)) throw new Error(r.problems.join(' '));
  return r.output;
}

describe('SME needs', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  const rlgym = fakeRlGym();
  const studio = fakeStudio();
  let clientId: string;
  let admin: string;
  let pm: string;
  let anvilKey: string;
  const { setFlow, signIn } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);
  const exportNow = (key = randomUUID()) => app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/exports`, headers: { cookie: pm, 'idempotency-key': key }, payload: {} });
  let pid: string;

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig({ ...RLGYM_CONFIG, ...STUDIO_CONFIG, ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() }),
      rlgymFetch: rlgym.fetch,
      studioFetch: studio.fetch,
      db,
      pingRedis: async () => true,
      google,
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage: new MemoryStorage(),
      email: new MemoryEmailSender(),
      embeddings: new HashingEmbeddingProvider(),
    });
  });
  beforeEach(async () => {
    await resetDb();
    rlgym.sent.length = 0;
    rlgym.state.mode = 'ok';
    rlgym.state.answer = null;
    studio.sent.length = 0;
    studio.state.mode = 'ok';
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: ADMIN_EMAIL, SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, ADMIN_EMAIL, 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    anvilKey = (await post(admin, '/api-clients', { name: 'RL Gym local', kind: 'ANVIL' })).json().key;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function publishedV8(): Promise<Template> {
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: WORKFLOW, primaryWork: 'Earlier KYC.', verificationCriteria: 'Earlier.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: structuredClone(V7) });
    expect(res.statusCode, res.body).toBe(201);
    const v7Id = res.json().data.template_version_id as string;
    expect((await post(admin, `/templates/${v7Id}/publish`)).statusCode).toBe(200);
    const v7 = await db.template.findUniqueOrThrow({ where: { id: v7Id } });
    const spec = structuredClone(EMBEDDED.spec) as JointTemplateSpec;
    spec.template_id = v7.lineageId;
    spec.version = v7.version + 1;
    spec.requirement.successor_of = { template_id: v7.lineageId, version: v7.version, template_sha256: jointHashes(jointTemplateSpec(v7)!).template_sha256 };
    const made = await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: ADMIN_EMAIL, apply: true, spec });
    expect(made.outcome, JSON.stringify(made)).toBe('created');
    expect((await post(admin, `/templates/${made.v8!.templateVersionId}/publish`)).statusCode).toBe(200);
    return db.template.findUniqueOrThrow({ where: { id: made.v8!.templateVersionId! } });
  }

  /** A KYC v8 project with four tasks, none approved yet. */
  async function v8Project() {
    const v8 = await publishedV8();
    await setFlow(true);
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: v8.skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: v8.id, name: 'KYC November', taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-11-05', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    pid = created.json().id as string;
    expect((await post(pm, `/projects/${pid}/submit`)).statusCode).toBe(200);
    return v8;
  }

  /** A person approves the task for an application type (writeApprovedRecord, as the console does). */
  async function approve(applicationType: string, output: unknown = boundOutput(applicationType)): Promise<ApprovedTaskRecord> {
    const tasks = await db.taskInstance.findMany({ where: { projectId: pid } });
    const task = tasks.find((t) => (t.input as { slot: { case: { value: string } } }).slot.case.value === applicationType)!;
    const reviewer = await createUser(clientId, ['ADMIN']);
    if (!task.assignedToId) {
      const sme = await db.smeUser.create({ data: { clientId, contactEmail: `${applicationType}-${randomUUID().slice(0, 4)}@sme.test` } });
      const cand = await db.candidate.create({ data: { clientId, smeUserId: sme.id } });
      await db.taskInstance.update({ where: { id: task.id }, data: { assignedToId: cand.id, assignedAt: new Date() } });
    }
    await db.taskInstance.update({ where: { id: task.id }, data: { status: 'ACCEPTED', submittedAt: new Date(), output: output as Prisma.InputJsonValue } });
    const version = (await db.taskSubmission.count({ where: { taskInstanceId: task.id } })) + 1;
    await db.taskSubmission.create({ data: { clientId, taskInstanceId: task.id, version, output: output as Prisma.InputJsonValue, checks: {} } });
    return db.$transaction((tx) => writeApprovedRecord(tx, { taskId: task.id, reviewerId: reviewer.id, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() }));
  }

  /** The task for an application type, assigned to a signed-in SME (who is its author). */
  async function authoredBy(applicationType: string) {
    const task = (await db.taskInstance.findMany({ where: { projectId: pid } })).find((t) => (t.input as { slot: { case: { value: string } } }).slot.case.value === applicationType)!;
    const me = await signIn(`${applicationType}-${randomUUID().slice(0, 6)}@gmail.test`);
    const cand = await db.candidate.create({ data: { clientId, smeUserId: me.smeUserId } });
    await db.taskInstance.update({ where: { id: task.id }, data: { assignedToId: cand.id, assignedAt: new Date(), status: 'IN_PROGRESS' } });
    return { task, cookie: me.cookie };
  }
  const authorNeed = (cookie: string, taskId: string, body: object) => app.inject({ method: 'POST', url: `/api/v1/me/tasks/${taskId}/needs`, headers: { cookie, ...idem() }, payload: body });
  const staffNeed = (cookie: string, body: object) => app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/needs`, headers: { cookie, ...idem() }, payload: body });
  const sendNeeds = (body: object) => app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/needs/send`, headers: { cookie: pm, ...idem() }, payload: body });
  const close = (needId: string, how: 'reject' | 'resolve', reason = 'Handled.') => app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/needs/${needId}/${how}`, headers: { cookie: pm, ...idem() }, payload: { reason } });

  it('an author sends a need to the PM about their own task; only they and the project staff see it', async () => {
    await v8Project();
    const { task, cookie } = await authoredBy('individual');
    const res = await authorNeed(cookie, task.id, { kind: 'more_data', note: 'Five more pending-TIN cases would help.' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ taskId: task.id, kind: 'more_data', raisedBy: 'AUTHOR', state: 'open', studioItemId: null });
    expect((await authorNeed(cookie, task.id, { kind: 'more_data', note: '  ' })).statusCode).toBe(400);
    expect((await authorNeed(cookie, task.id, { kind: 'template_wording', note: 'x' })).statusCode).toBe(400);
    expect((await get(cookie, `/me/tasks/${task.id}/needs`)).json().items).toHaveLength(1);
    // Another SME cannot raise or read needs on this task.
    const other = await authoredBy('adult_joint');
    expect((await authorNeed(other.cookie, task.id, { kind: 'more_data', note: 'x' })).statusCode).toBe(404);
    expect((await get(other.cookie, `/me/tasks/${task.id}/needs`)).statusCode).toBe(404);
    // The PM sees it; the author is shown by role, not by name.
    const list = (await get(pm, `/projects/${pid}/needs`)).json();
    expect(list).toMatchObject({ connected: true, items: [{ raisedBy: 'AUTHOR', raisedByName: null, state: 'open' }] });
    expect(await db.auditEvent.count({ where: { entityId: task.id, action: 'task.need_raised' } })).toBe(1);
  });

  it('Reviewers on the project and the PM raise needs in the console; only the PM sends them to Studio as one item', async () => {
    const v8 = await v8Project();
    await qualifyForRlGym(v8.id, REF);
    const reviewerUser = await createUser(clientId, ['REVIEWER']);
    await db.projectReviewer.create({ data: { clientId, projectId: pid, userId: reviewerUser.id, assignedById: reviewerUser.id } });
    const reviewer = await login(app, reviewerUser.email);
    const r = await staffNeed(reviewer, { kind: 'more_data', note: 'Too few custodial cases with a guardian change.', source: { batchId: 'smr-0001', itemId: 'item-3' } });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ raisedBy: 'REVIEWER', raisedByName: reviewerUser.name });
    const p = (await staffNeed(pm, { kind: 'more_data', note: 'Add teen joint cases where a parent signs late.' })).json();
    expect(p.raisedBy).toBe('PM');
    const unassigned = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
    expect((await staffNeed(unassigned, { kind: 'more_data', note: 'x' })).statusCode).toBe(404);
    // A Reviewer cannot send to Studio.
    expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/needs/send`, headers: { cookie: reviewer, ...idem() }, payload: { needIds: [p.id], summary: 'x' } })).statusCode).toBe(403);

    const res = await sendNeeds({ needIds: [r.json().id, p.id], summary: 'KYC November needs more cases in two cells.', neededBy: '2026-12-15' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().items.every((n: { state: string; studioItemId: string }) => n.state === 'sent' && n.studioItemId === 'inb-0042')).toBe(true);
    expect(studio.sent).toHaveLength(1);
    const [s] = studio.sent;
    expect(s!.url).toBe('http://127.0.0.1:8000/api/v1/inbox-items');
    expect(s!.headers).toMatchObject({ 'X-Tenant-Id': STUDIO_CONFIG.STUDIO_TENANT_ID, 'X-Actor-Id': STUDIO_CONFIG.STUDIO_SERVICE_ACTOR_ID, 'X-Actor-Kind': 'service', 'X-Actor-Roles': 'service' });
    expect(s!.headers['Idempotency-Key']).toMatch(/^forge-needs-[0-9a-f]{32}$/);
    // Exactly Studio's fields; evidence names no person.
    expect(Object.keys(s!.body).sort()).toEqual(['evidence', 'kind', 'needed_by', 'project_id', 'source', 'summary', 'template_id', 'version']);
    expect(s!.body).toMatchObject({ kind: 'more_data', source: 'adi-forge', template_id: REF.id, version: REF.version, project_id: pid, summary: 'KYC November needs more cases in two cells.', needed_by: '2026-12-15' });
    expect(s!.body.evidence).toHaveLength(2);
    expect(JSON.stringify(s!.body)).not.toContain(reviewerUser.name);
    expect(JSON.stringify(s!.body)).not.toMatch(/@/);
    // Sent once: a second send of the same needs is refused.
    expect((await sendNeeds({ needIds: [p.id], summary: 'again' })).json().error).toBe('NEED_NOT_OPEN');
  });

  it('kinds are sent separately; a refused send keeps the needs open with the error; reject and resolve close them once', async () => {
    await v8Project();
    const a = (await staffNeed(pm, { kind: 'more_data', note: 'More data.' })).json();
    const b = (await staffNeed(pm, { kind: 'new_case_kind', note: 'A trust with two trustees.' })).json();
    expect((await sendNeeds({ needIds: [a.id, b.id], summary: 'mixed' })).json().error).toBe('NEED_KINDS_MIXED');
    studio.state.mode = 'error';
    const failed = await sendNeeds({ needIds: [a.id], summary: 'More data please.' });
    expect(failed.statusCode).toBe(201);
    expect(failed.json().items[0]).toMatchObject({ state: 'open', lastError: { code: 'VALIDATION_FAILED' } });
    studio.state.mode = 'ok';
    expect((await sendNeeds({ needIds: [a.id], summary: 'More data please.' })).json().items[0]).toMatchObject({ state: 'sent', lastError: null });
    expect((await close(a.id, 'reject')).json().error).toBe('NEED_SENT');
    expect((await close(a.id, 'resolve', 'Studio released V10 with the data.')).json()).toMatchObject({ state: 'resolved', closedReason: 'Studio released V10 with the data.' });
    expect((await close(a.id, 'resolve')).json().error).toBe('NEED_CLOSED');
    expect((await close(b.id, 'reject', 'Out of scope for this benchmark.')).json()).toMatchObject({ state: 'rejected' });
    for (const t of ['SmeNeed', 'SmeNeedClosure', 'SmeNeedSend']) await expect(db.$executeRawUnsafe(`DELETE FROM "${t}"`)).rejects.toThrow();
  });

  it('a task with an open or sent "new edge case" need is held back from export until the PM resolves it', async () => {
    const v8 = await v8Project();
    await qualifyForRlGym(v8.id, REF);
    const a = await approve('individual');
    await approve('adult_joint');
    const need = (await staffNeed(pm, { kind: 'new_case_kind', note: 'Needs a deceased co-applicant case kind.', taskId: a.taskInstanceId })).json();
    const first = (await exportNow()).json();
    expect(first.notSent).toEqual([expect.objectContaining({ recordId: a.id, code: 'WAITING_FOR_NEW_CASE_KIND' })]);
    expect(rlgym.sent.at(-1)!.body.tasks.map((t: { task_id: string }) => t.task_id)).not.toContain(a.taskInstanceId);
    // Sent to Studio: still held.
    expect((await sendNeeds({ needIds: [need.id], summary: 'New case kind: deceased co-applicant.' })).statusCode).toBe(201);
    expect((await exportNow()).json().notSent.map((n: { code: string }) => n.code)).toEqual(['WAITING_FOR_NEW_CASE_KIND']);
    // Resolved: exported.
    await close(need.id, 'resolve', 'Handled in the next template version.');
    const after = (await exportNow()).json();
    expect(after.notSent).toEqual([]);
    expect(rlgym.sent.at(-1)!.body.tasks.map((t: { task_id: string }) => t.task_id)).toContain(a.taskInstanceId);
  });
});
