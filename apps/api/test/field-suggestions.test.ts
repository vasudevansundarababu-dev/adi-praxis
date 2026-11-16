import type { Template } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUTHORSHIP_VERSION, emptyOutput, hashValue, sectionDigest, setFieldValue, TemplateProfileSchema, type SuggestionsResponse, type SuggestionState, type TemplateProfile } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { FieldSuggesterUnavailableError, MockFieldSuggester, type FieldSuggester } from '../src/tasks/suggestions/assistant';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Suggested text for every field, provenance and per-section confirmation (owner decisions 1-6, 15 Nov 2026;
 * docs/design/SUGGESTED-TEXT-AND-RUBRIC-TABLE.md) on the KYC v7 template (synthetic RL Gym fixture). Mocks only.
 */
const SECRET = 'test-mock-secret';
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const WORKFLOW = 'KYC onboarding and refresh';

/** A scripted suggester: returns what the test sets (to exercise the guards), counting calls. */
class ScriptedSuggester implements FieldSuggester {
  readonly modelVersion = 'scripted-1';
  calls = 0;
  next: { key: string; value: unknown }[] | Error = [];
  async suggest() {
    this.calls++;
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

describe('field suggestions (FIELD_SUGGESTIONS_ENABLED)', () => {
  let app: FastifyInstance;
  let off: FastifyInstance;
  let scripted: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  const mock = new MockFieldSuggester();
  const script = new ScriptedSuggester();
  let clientId: string;
  let admin: string;
  let pm: string;
  let anvilKey: string;
  const kit = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}, a: FastifyInstance = app) => (a === app ? call(app, 'POST', cookie, url, payload) : a.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload }));
  const put = (cookie: string, url: string, payload: object) => call(app, 'PUT', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  const build = (enabled: boolean, suggester: FieldSuggester = mock) =>
    buildApp({
      config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString(), FIELD_SUGGESTIONS_ENABLED: enabled ? 'true' : 'false' }),
      db,
      pingRedis: async () => true,
      google,
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage: new MemoryStorage(),
      email: new MemoryEmailSender(),
      embeddings: new HashingEmbeddingProvider(),
      fieldSuggester: suggester,
    });

  beforeAll(async () => {
    app = await build(true);
    off = await build(false);
    scripted = await build(true, script);
  });
  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    anvilKey = (await post(admin, '/api-clients', { name: 'RL Gym QA', kind: 'ANVIL' })).json().key;
    script.next = [];
    script.calls = 0;
  });
  afterAll(async () => {
    await app.close();
    await off.close();
    await scripted.close();
    await db.$disconnect();
  });

  async function v7Template() {
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: WORKFLOW, primaryWork: 'Earlier KYC.', verificationCriteria: 'Earlier.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: structuredClone(V7) });
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().data.template_version_id as string;
    expect((await post(admin, `/templates/${id}/publish`)).statusCode).toBe(200);
    return db.template.findUniqueOrThrow({ where: { id } });
  }
  async function project(templateId: string, experience: 'CLASSIC' | null = null) {
    await kit.setFlow(true);
    const skills = (await db.template.findUniqueOrThrow({ where: { id: templateId } })).skills;
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const pid = created.json().id as string;
    await db.project.update({ where: { id: pid }, data: { authoringExperience: experience } });
    expect((await post(pm, `/projects/${pid}/submit`)).statusCode).toBe(200);
    return pid;
  }
  const formOf = (t: Template) => TemplateProfileSchema.parse((t.anvilSpec as { authoring: { profile: unknown } }).authoring.profile) as TemplateProfile;

  /** v7 project, the Custodian task assigned to a signed-in SME, its title written by the author. */
  async function setup(experience: 'CLASSIC' | null = null) {
    const v7 = await v7Template();
    const profile = formOf(v7);
    const pid = await project(v7.id, experience);
    const task = (await db.taskInstance.findMany({ where: { projectId: pid }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } }))[3]!;
    const sme = await kit.source(pid, 'SME', { email: 'author@gmail.test', first: 'Ada', last: 'Author' });
    expect((await kit.assign(pid, sme.id, task.id)).statusCode).toBe(200);
    const me = await kit.signIn('author@gmail.test');
    let out = emptyOutput(profile);
    out = setFieldValue(profile, out, 'S1', 'applicationType', 'custodial');
    out = setFieldValue(profile, out, 'S1', 'title', 'Custodial account KYC');
    out = setFieldValue(profile, out, 'S8', 'reviewerNotes', 'Legal review of the golden bank operating choices is still pending at this time.');
    if (experience) expect((await post(me.cookie, `/me/tasks/${task.id}/conversation/consent`, { version: AUTHORSHIP_VERSION, accepted: true })).statusCode).toBe(200);
    const save = async (output: object) => {
      const rev = (await get(me.cookie, `/me/tasks/${task.id}`)).json().revision as number;
      const r = await put(me.cookie, `/me/tasks/${task.id}`, { output, activeSecondsDelta: 5, expectedRevision: rev });
      expect(r.statusCode, r.body).toBe(200);
      return output as Record<string, unknown>;
    };
    await save(out);
    const state = async () => (await get(me.cookie, `/me/tasks/${task.id}/suggestions`)).json() as { state: SuggestionState; summary: { counts: Record<string, number>; confirmedCount: number; toConfirm: number } };
    return { v7, profile, pid, task, me, out, save, state };
  }

  it('flag off: no suggestion routes and the task view says so; flag on: it does', async () => {
    const s = await setup();
    const g = (url: string) => off.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie: s.me.cookie } });
    expect((await g(`/me/tasks/${s.task.id}/suggestions`)).statusCode).toBe(404);
    expect((await g(`/me/tasks/${s.task.id}`)).json().fieldSuggestions).toBe(false);
    expect((await get(s.me.cookie, `/me/tasks/${s.task.id}`)).json().fieldSuggestions).toBe(true);
  });

  it('suggests for the section’s empty fields only, shaped to each field; kept until the author asks again (audited)', async () => {
    const s = await setup();
    const r = await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions`, { section: 'S1' });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as SuggestionsResponse;
    const keys = body.items.map((i) => i.key);
    // Not the author's own title, not the slot's case selector.
    expect(keys).not.toContain('title');
    expect(keys).not.toContain('applicationType');
    expect(keys).toEqual(expect.arrayContaining(['trigger', 'businessContext', 'deliverable', 'scope', 'language']));
    for (const i of body.items) expect(i.hash).toBe(hashValue(i.value));
    // A pick list only ever gets one of its options.
    const state = body.items.find((i) => i.key === 'exampleGoverningState');
    if (state) expect(s.profile.sections[0]!.fields.find((f) => f.key === 'exampleGoverningState')!.options!.map((o) => o.value)).toContain(state.value);
    expect(body.model).toBe('mock-field-suggestions-1');
    const calls = mock.calls;
    expect((await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions`, { section: 'S1' })).json()).toEqual(body);
    expect(mock.calls).toBe(calls);
    const again = (await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions`, { section: 'S1', keys: ['scope'], again: true })).json() as SuggestionsResponse;
    expect(mock.calls).toBe(calls + 1);
    expect(again.items.find((i) => i.key === 'scope')!.value).toMatch(/\(reworded\)$/);
    expect(again.items.find((i) => i.key === 'trigger')).toEqual(body.items.find((i) => i.key === 'trigger'));
    expect(await db.auditEvent.count({ where: { action: 'task.suggestions.generated', entityId: s.task.id } })).toBe(2);
    // S4 policy references and the S7 rubric are not suggested.
    expect((await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions`, { section: 'S4' })).json().items).toEqual([]);
    expect((await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions`, { section: 'S7' })).json().items.map((i: { key: string }) => i.key)).toEqual(['scoringRule']);
  });

  it('guards: no likely-real data, no private reference answer in an agent-visible field, values outside a pick list dropped', async () => {
    const s = await setup();
    script.next = [
      { key: 'trigger', value: 'Customer John Smith, SSN 123-45-6789, email john.smith@example.com opens an account.' },
      { key: 'businessContext', value: 'Note: legal review of the golden bank operating choices is still pending at this time.' },
      { key: 'exampleGoverningState', value: 'Atlantis' },
      { key: 'scope', value: 'Custodial applications in every applicable governing state.' },
    ];
    const r = await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions`, { section: 'S1' }, scripted);
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as SuggestionsResponse).items.map((i) => i.key)).toEqual(['scope']);
    script.next = new FieldSuggesterUnavailableError('timeout');
    const down = await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions`, { section: 'S2' }, scripted);
    expect(down.statusCode).toBe(503);
    expect(down.json().message).toMatch(/Write the text yourself/);
  });

  it('use, edit and undo: the origin is derived from the saved value; only offered suggestions can be recorded', async () => {
    const s = await setup();
    const offered = (await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions`, { section: 'S1' })).json() as SuggestionsResponse;
    const trigger = offered.items.find((i) => i.key === 'trigger')!;
    const scope = offered.items.find((i) => i.key === 'scope')!;
    expect((await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions/use`, { section: 'S1', items: [{ key: 'trigger', hash: 'f'.repeat(16) }] })).statusCode).toBe(409);
    const used = await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions/use`, { section: 'S1', items: [{ key: 'trigger', hash: trigger.hash }, { key: 'scope', hash: scope.hash }] });
    expect(used.statusCode, used.body).toBe(200);
    let out = setFieldValue(s.profile, s.out, 'S1', 'trigger', trigger.value);
    out = setFieldValue(s.profile, out, 'S1', 'scope', `${scope.value as string} Each state’s rules apply.`);
    await s.save(out);
    let st = await s.state();
    // title: written by the author; trigger: as is; scope: edited; reviewer notes: written by the author. The selector is not counted.
    expect(st.summary.counts).toEqual({ AUTHOR: 2, SUGGESTION_AS_IS: 1, SUGGESTION_EDITED: 1 });
    expect((await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions/clear`, { section: 'S1', key: 'scope' })).statusCode).toBe(200);
    st = await s.state();
    expect(st.state.used['S1.scope']).toBeUndefined();
    expect(st.summary.counts).toEqual({ AUTHOR: 3, SUGGESTION_AS_IS: 1, SUGGESTION_EDITED: 0 });
    expect(await db.auditEvent.count({ where: { action: 'task.suggestion.used', entityId: s.task.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'task.suggestion.cleared', entityId: s.task.id } })).toBe(1);
  });

  it('section confirmation is bound to the saved content; a change makes it stale and Submit lists every unconfirmed section', async () => {
    const s = await setup();
    const stale = await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions/confirm`, { section: 'S1', confirmed: true, digest: 'a'.repeat(16) });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('SECTION_NOT_SAVED');
    const ok = await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions/confirm`, { section: 'S1', confirmed: true, digest: sectionDigest(s.profile, s.out, 'S1') });
    expect(ok.statusCode, ok.body).toBe(200);
    const first = await post(s.me.cookie, `/me/tasks/${s.task.id}/check`, {});
    expect(first.statusCode, first.body).toBe(200);
    let checks = first.json().checks as { id: string; ok: boolean; section: string; message: string }[];
    let open = checks.filter((c) => c.id.startsWith('suggestions.confirmed.'));
    expect(open.map((c) => c.section)).toEqual(['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    expect(open[0]!.message).toBe('Confirm S2: tick that you’ve read every field and it describes how this work is really done');
    // A change in S1 after confirming makes S1 unconfirmed again.
    await s.save(setFieldValue(s.profile, s.out, 'S1', 'scope', 'Changed after confirming'));
    checks = (await post(s.me.cookie, `/me/tasks/${s.task.id}/check`, {})).json().checks;
    open = checks.filter((c) => c.id.startsWith('suggestions.confirmed.'));
    expect(open.map((c) => c.section)).toContain('S1');
    expect((await s.state()).summary.confirmedCount).toBe(0);
    // Untick is recorded too.
    expect((await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions/confirm`, { section: 'S1', confirmed: false, digest: 'a'.repeat(16) })).statusCode).toBe(200);
    expect(await db.auditEvent.count({ where: { action: 'task.section.confirmed', entityId: s.task.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'task.section.unconfirmed', entityId: s.task.id } })).toBe(1);
    // Flag off: no confirmation check at all.
    const offChecks = (await off.inject({ method: 'POST', url: `/api/v1/me/tasks/${s.task.id}/check`, headers: { cookie: s.me.cookie, ...idem() }, payload: {} })).json().checks as { id: string }[];
    expect(offChecks.some((c) => c.id.startsWith('suggestions.'))).toBe(false);
  });

  it('decision 1: new authorship terms; an earlier AI draft no longer blocks the declaration once every section is confirmed', async () => {
    const s = await setup('CLASSIC');
    expect(AUTHORSHIP_VERSION).toBe('human-review/2');
    expect((await post(s.me.cookie, `/me/tasks/${s.task.id}/conversation/consent`, { version: 'human-only/1', accepted: true })).statusCode).toBe(400);
    await db.taskDraftRun.create({ data: { clientId, taskInstanceId: s.task.id, requestedById: (await db.taskInstance.findUniqueOrThrow({ where: { id: s.task.id }, include: { assignedTo: true } })).assignedTo!.smeUserId, section: 'W01', status: 'SUCCEEDED', model: 'm', promptVersion: 'drafter/1' } });
    const review = async (a: FastifyInstance = app) => {
      const rev = (await get(s.me.cookie, `/me/tasks/${s.task.id}`)).json().revision as number;
      return post(s.me.cookie, `/me/tasks/${s.task.id}/conversation/review`, { expectedRevision: rev, ownWork: true, noExternalLlm: true, authorisedSources: true }, a);
    };
    const blocked = await review();
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json().error).toBe('SECTIONS_NOT_CONFIRMED');
    for (const sec of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']) expect((await post(s.me.cookie, `/me/tasks/${s.task.id}/suggestions/confirm`, { section: sec, confirmed: true, digest: sectionDigest(s.profile, s.out, sec) })).statusCode).toBe(200);
    const passed = await review();
    expect(passed.statusCode, passed.body).toBe(200);
    // Flag off: the earlier rule stands.
    expect((await review(off)).json().error).toBe('PRIOR_AI_DRAFT');
  });
});
