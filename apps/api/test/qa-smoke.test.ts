import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTHORSHIP_VERSION, GOLDEN_KYC_EXAMPLE } from '@praxis/shared';
import { bindCriteriaFromChecks, buildOutput, defaultPolicyMarkdown, NEEDS, optionsFromEnv, qaSmoke, SMOKE_PREFIX, STEPS, type QaSmokeOptions } from '../src/jobs/qa-smoke';
import type { Http, HttpResponse } from '../src/jobs/qa-users';
import { JOINT_TEMPLATE_SPEC } from '../src/anvil/joint-template';
import { anvilSpecChecks } from '../src/tasks/submission';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';

/**
 * The QA smoke job's orchestration against a scripted fake of the public API: no live service, no database. The fake
 * answers each route the way the real API does (shapes taken from the route handlers), records who called what, and
 * can be told to fail one part of the journey.
 */

const PW = { admin: 'admin-secret-pw-1', pm: 'pm-secret-password-2', reviewer: 'reviewer-secret-pw-3' };
const P = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Call { who: string; method: string; path: string; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Scenario {
  readyz?: number;
  citations?: string[];
  extraction?: { status: string; candidateCount: number; error?: string | null };
  validator?: string;
  chat?: 'SUCCEEDED' | 'FAILED';
  echoPasswordOnLogin?: boolean;
  slotCase?: { field: string; source: string; value: string } | null;
}

function fakeApi(sc: Scenario = {}) {
  const calls: Call[] = [];
  const s = { projectStatus: 'DRAFT', enrollment: 'DRAFT', onboarding: 'NOT_STARTED', polls: 0, taskRevision: 0, ruleReviewed: false, saved: null as unknown, chatPending: true, accepted: false, cancelled: false };
  const ok = (body: unknown, status = 200, cookies: string[] = []): HttpResponse => ({ status, body, cookies, retryAfterSeconds: null });
  const err = (status: number, error: string, message: string, details?: unknown) => ok({ error, message, requestId: 'req-1', ...(details ? { details } : {}) }, status);
  const whoOf = (cookie?: string) => cookie?.match(/who=([a-z]+)/)?.[1] ?? 'anon';

  const http: Http = async ({ method, path: p, body, cookie, root, form }) => {
    const who = whoOf(cookie);
    calls.push({ who, method, path: (root ? '' : '/api/v1') + p, body: form ? { form: { fields: form.fields, file: form.file.name } } : body });
    const b = (body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const route = `${method} ${p}`;
    if (root && route === 'GET /readyz') return ok({ status: (sc.readyz ?? 200) === 200 ? 'ok' : 'unavailable', db: true, redis: true }, sc.readyz ?? 200);
    switch (true) {
      case route === 'POST /auth/login': {
        const role = b.email.startsWith('admin') ? 'admin' : b.email.startsWith('pm') ? 'pm' : 'reviewer';
        if (sc.echoPasswordOnLogin && role === 'reviewer') return err(401, 'BAD_LOGIN', `Wrong password ${b.password}`);
        if (b.password !== PW[role as keyof typeof PW]) return err(401, 'BAD_LOGIN', 'Wrong email or password');
        return ok({ id: id(1) }, 200, [`who=${role}`]);
      }
      case route === 'GET /users':
        return ok({ items: [{ id: id(90), email: 'reviewer01@praxis.test', roles: ['REVIEWER'], status: 'ACTIVE' }, { id: id(91), email: 'pm@praxis.demo', roles: ['PM'], status: 'ACTIVE' }] });
      case route === 'GET /templates':
        return ok({ items: [
          { id: id(10), workflowName: 'KYC onboarding and refresh', version: 1, status: 'PUBLISHED', taskModes: ['AUTHORING'], profileId: null, skills: ['KYC'], domainName: 'Banking', defaultTptMinutes: 90 },
          { id: id(11), workflowName: 'KYC onboarding and refresh', version: 3, status: 'PUBLISHED', taskModes: ['AUTHORING'], profileId: 'kyc-account-opening', skills: ['KYC'], domainName: 'Banking', defaultTptMinutes: 90 },
          { id: id(12), workflowName: 'Sanctions screening', version: 9, status: 'PUBLISHED', taskModes: ['AUTHORING'], profileId: null, skills: [], domainName: 'Banking' },
        ] });
      case route === 'POST /job-descriptions':
        return ok({ id: id(20) }, 201);
      case route === 'POST /projects':
        return ok({ id: P, name: b.name, status: 'DRAFT' }, 201);
      case route === `POST /projects/${P}/submit`:
        s.projectStatus = 'READY_FOR_STAFFING';
        return ok({ id: P, status: s.projectStatus });
      case route === `POST /projects/${P}/opportunity/publish`:
      case route === `POST /projects/${P}/reviewers`:
        return ok({});
      case route === `GET /projects/${P}/opportunity`:
        return ok({ projectId: P, opportunityId: id(30), status: 'PUBLISHED' });
      // ── policy ──
      case route === `POST /projects/${P}/policy/documents`:
        return ok({ documentId: id(40), version: { id: id(41) }, created: true }, 201);
      case route === `GET /projects/${P}/policy/extraction`: {
        s.polls++;
        const done = s.polls >= 3;
        const x = sc.extraction ?? { status: 'SUCCEEDED', candidateCount: 3, error: null };
        const job = { id: id(43), status: done ? x.status : 'PROCESSING', provider: 'llamaextract', candidateCount: done ? x.candidateCount : null, error: done ? (x.error ?? null) : null, ...(who === 'admin' ? { estimatedUsd: 0.1, actualUsd: done ? 0.09 : null } : {}) };
        return ok({ available: true, problems: [], profile: { provider: 'llamaextract' }, batches: s.polls > 1 ? [{ id: id(42), status: done ? x.status : 'PROCESSING', jobs: [job] }] : [] });
      }
      case route === `POST /projects/${P}/policy/extraction`:
        return ok({ batchId: id(42), status: 'QUEUED', created: true, jobs: [{ id: id(43), status: 'QUEUED' }] }, 202);
      case route === `GET /projects/${P}/policy/rules`: {
        const res = sc.citations ?? ['RESOLVED', 'RESOLVED', 'QUOTE_MISMATCH'];
        return ok({ items: [
          { ruleId: id(50), ruleKey: 'NW-2.1', versionId: id(51), state: 'EXTRACTED', sources: res.slice(0, 2).map((resolution) => ({ resolution })) },
          { ruleId: id(52), ruleKey: 'NW-3.1', versionId: id(53), state: 'EXTRACTED', sources: res.slice(2).map((resolution) => ({ resolution })) },
        ] });
      }
      case route === `GET /projects/${P}/policy/rule-versions/${id(51)}`:
        return ok({ ruleId: id(50), ruleKey: 'NW-2.1', versionId: id(51), state: s.ruleReviewed ? 'REVIEWED' : 'EXTRACTED', contentHash: 'a'.repeat(64), problems: ['Applicability needs a person'], citations: [] });
      case route === `GET /projects/${P}/policy/rule-versions/${id(53)}`:
        return ok({ ruleId: id(52), ruleKey: 'NW-3.1', versionId: id(53), state: 'EXTRACTED', contentHash: 'b'.repeat(64), problems: [], body: { requirement: 'Confirm address' }, citations: [{ quote: 'The analyst must confirm the residential address' }] });
      case route === `POST /projects/${P}/policy/rule-versions/${id(53)}/review`:
        expect(b).toEqual({ expectedContentHash: 'b'.repeat(64), required: true });
        return ok({ versionId: id(53), state: 'REVIEWED' });
      case route === `POST /projects/${P}/policy/rule-versions/${id(51)}/exclude`:
        expect(b).toEqual({ expectedContentHash: 'a'.repeat(64), reason: expect.stringContaining('Applicability needs a person') });
        return ok({ versionId: id(51), state: 'EXCLUDED' });
      case route === `POST /projects/${P}/policy/rule-set`:
        return ok({ id: id(54), version: 1, digest: 'd', created: true }, 201);
      // ── staffing ──
      case route === 'POST /auth/dev/google-token':
        return ok({ credential: 'mock-credential' });
      case route === 'POST /auth/google':
        return ok({ id: id(60), identityStatus: 'NOT_STARTED' }, 200, ['who=sme']);
      case route === 'POST /me/identity/session':
        return ok({ url: `https://api.test/dev/identity/vs_mock_123?returnTo=x` });
      case route === 'POST /dev/identity/vs_mock_123/simulate':
        return ok({});
      case route === 'POST /me/enrollments':
        return ok({ id: id(61), status: s.enrollment }, 201);
      case route === `GET /me/enrollments/${id(61)}/conversation`:
        return ok({ session: { revision: 1 }, questions: [{ fields: ['years_experience'], answerType: 'number', options: [] }, { fields: ['roles'], answerType: 'text', options: [] }], profile: { fields: {}, roles: [], claims: [] } });
      case route === 'POST /me/profile/corrections':
        return ok({ session: { revision: 2 } });
      case route === `POST /me/enrollments/${id(61)}/submit`:
        s.enrollment = 'SUBMITTED';
        return ok({});
      case route === `GET /me/enrollments/${id(61)}/status`: {
        if (s.enrollment === 'SUBMITTED') s.enrollment = 'REVIEW_PENDING';
        return ok({ id: id(61), status: s.enrollment, onboardingStatus: s.onboarding });
      }
      case route === `GET /review/enrollments/${id(61)}`:
        return ok({ id: id(61), status: s.enrollment, assessment: { status: 'FIT_RECOMMENDED', modelVersion: 'gemini:gemini-3.8-flash' }, opportunity: { brief: {} } });
      case route === `POST /review/enrollments/${id(61)}/decision`:
        s.enrollment = 'SELECTED';
        return ok({});
      case route === `GET /me/onboarding?enrollmentId=${id(61)}`:
        return ok({ items: [{ key: 'terms', kind: 'terms', done: false, terms: { sha256: 'h' } }, { key: 'prefs', kind: 'preferences', done: false, terms: null }, { key: 'payee', kind: 'payee', done: false, terms: null }] });
      case route === 'POST /me/onboarding/acknowledgements':
        if (b.itemKey === 'prefs') s.onboarding = 'COMPLETE';
        return ok({});
      case route === `POST /projects/${P}/match`:
        s.projectStatus = 'STAFFING';
        return ok({ items: [{ candidateId: id(70), name: 'SYNTHETIC QA pool SME 01' }, { candidateId: id(71), name: calls.find((c) => c.path === '/api/v1/auth/dev/google-token')!.body.name }], warnings: [] });
      case route === `POST /projects/${P}/assignments`:
        expect(b).toEqual({ candidateIds: [id(71)] });
        return ok({ items: [] });
      case route === 'GET /me/assignments':
        return ok({ items: [{ id: id(72), status: s.accepted ? 'ACCEPTED' : 'PROPOSED', revision: 0 }] });
      case route === `POST /me/assignments/${id(72)}/accept`:
        s.accepted = true;
        s.projectStatus = 'IN_PROGRESS';
        return ok({ id: id(72), status: 'ACCEPTED' });
      // ── authoring ──
      case route === `GET /me/projects/${P}`:
        return ok({ tasks: s.accepted ? [{ id: id(80), status: 'ASSIGNED' }] : [], canPull: false });
      case route === `GET /me/tasks/${id(80)}`:
        return ok({ id: id(80), revision: s.taskRevision, definition: 'profile:kyc-account-opening', template: { workflow: 'KYC onboarding and refresh', profileId: 'kyc-account-opening', profile: null }, input: { slot: { brief: 'state: IL', tags: { state: 'IL' }, edgeCase: null, isOpen: false, ...(sc.slotCase === null ? {} : { case: sc.slotCase ?? { field: 'state', source: 'S1.scope', value: 'US-IL' } }) } } });
      case route === `POST /me/tasks/${id(80)}/conversation/consent`:
        expect(b).toEqual({ version: AUTHORSHIP_VERSION, accepted: true });
        return ok({ accepted: true });
      case route === `PUT /me/tasks/${id(80)}`:
        s.saved = b.output;
        s.taskRevision++;
        return ok({ revision: s.taskRevision });
      case route === `POST /me/tasks/${id(80)}/conversation/messages`:
        expect(b.expectedRevision).toBe(s.taskRevision);
        return ok({ runId: id(81) }, 202);
      case route === `GET /me/tasks/${id(80)}/conversation`:
        return ok({ revision: s.taskRevision, state: { pending: s.chatPending ? { runId: id(81) } : undefined, unresolved: s.chatPending ? [] : ['Which document proves the address?'] }, run: { id: id(81), status: sc.chat ?? 'SUCCEEDED', error: sc.chat === 'FAILED' ? 'Vertex 429' : null, model: 'gemini:gemini-3.8-flash' } });
      case route === `POST /me/tasks/${id(80)}/conversation/decision`:
        expect(b).toEqual({ runId: id(81), accept: false });
        s.chatPending = false;
        return ok({ accepted: false });
      case route === `POST /me/tasks/${id(80)}/conversation/review`:
        expect(b.resolutions).toHaveLength(1);
        return ok({ reviewed: true });
      case route === `POST /me/tasks/${id(80)}/submit`:
        if (!Object.keys(b.flagExplanations ?? {}).length) return err(422, 'CHECKS_FAILED', 'Some checks need attention before you can submit.', { checks: [{ id: 'profile.complete', ok: true }], flags: [{ id: 'names.real' }], unexplained: ['names.real'] });
        return ok({ status: 'SUBMITTED', version: 1 });
      // ── review ──
      case route === `GET /review/tasks/${id(80)}`:
        return ok({ id: id(80), revision: s.taskRevision + 1, slot: { isOpen: false }, coverageTags: { tags: { state: 'IL' }, edgeCase: null } });
      case route === `POST /review/tasks/${id(80)}/decision`:
        return ok({ decision: 'ACCEPT' });
      case route === `GET /dataset/records?projectId=${P}`:
        return ok({ items: [{ id: id(85), taskInstanceId: id(80), seq: '7' }], next: null });
      case route === 'GET /dataset/verification':
        return ok({ table: 'ApprovedTaskRecord', checked: 7, breaks: [], ok: true });
      // ── export ──
      case route === `GET /projects/${P}/export`:
        return ok({ canValidate: true, canExport: false, reason: '1 of 1', validator: { name: sc.validator ?? 'praxis-precheck', isAnvil: false }, tasks: [{ recordId: id(85) }] });
      case route === `POST /projects/${P}/validate`:
        expect(b).toEqual({ recordIds: [id(85)] });
        return ok({ id: id(86), validator: 'praxis-precheck', results: [{ recordId: id(85), status: 'needs_fix', issues: [{ code: 'MISSING_BINDING' }] }] }, 201);
      // ── cleanup ──
      case route === `GET /projects/${P}`:
        return ok({ id: P, status: s.projectStatus });
      case route === `POST /projects/${P}/pause`:
        s.projectStatus = 'PAUSED';
        return ok({ status: 'PAUSED' });
      case route === `POST /projects/${P}/cancel`:
        s.cancelled = true;
        s.projectStatus = 'CANCELLED';
        return ok({ status: 'CANCELLED' });
    }
    return err(404, 'NOT_FOUND', `fake API has no route ${route}`);
  };
  return { http, calls, state: s };
}

function options(http: Http, over: Partial<QaSmokeOptions> = {}): QaSmokeOptions {
  const env = { DEMO_ADMIN_PASSWORD: PW.admin, DEMO_PM_PASSWORD: PW.pm, QA_SEED_REVIEWER_PASSWORD: PW.reviewer };
  return { ...optionsFromEnv(env, 'demo', http, new Date('2026-11-14T09:30:00Z')), pollMs: 1, sleep: async () => {}, now: () => new Date('2026-11-14T09:30:00Z'), ...over };
}
const logs: string[] = [];
const log = (level: string, message: string, extra: object = {}) => logs.push(JSON.stringify({ level, message, ...extra }));
const statuses = (r: { steps: { name: string; status: string }[] }) => Object.fromEntries(r.steps.map((x) => [x.name, x.status]));

describe('qa-smoke: QA end-to-end smoke job (orchestration, mocked HTTP)', () => {
  it('refuses APP_ENV=production, in the function and as a run.ts job', async () => {
    const api = fakeApi();
    await expect(qaSmoke(options(api.http, { appEnv: 'production' }), log)).rejects.toThrow(/qa-smoke refuses to run with APP_ENV=production/);
    expect(api.calls).toEqual([]);
    let out = '';
    let code = 0;
    try {
      execFileSync('npx', ['tsx', 'src/jobs/run.ts', 'qa-smoke'], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'production', DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL, API_URL: 'http://127.0.0.1:9' },
        encoding: 'utf8',
      });
    } catch (e) {
      const x = e as { status: number; stdout: string };
      code = x.status;
      out = x.stdout;
    }
    expect(code).toBe(1);
    expect(out).toMatch(/qa-smoke refuses to run with APP_ENV=production/);
  }, 60_000);

  it('walks the whole journey and reports PASS per step, ids, and paid calls with cost', async () => {
    const api = fakeApi();
    const r = await qaSmoke(options(api.http), log);
    expect(r.report).toBe('qa-smoke');
    expect(r.ok).toBe(true);
    expect(r.steps.map((x) => x.name)).toEqual([...STEPS]);
    expect(statuses(r)).toEqual(Object.fromEntries(STEPS.map((n) => [n, 'PASS'])));
    for (const x of r.steps) expect(x.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.ids).toMatchObject({ projectId: P, templateId: id(11), documentVersionId: id(41), extractionBatchId: id(42), ruleVersionId: id(53), ruleSetId: id(54), enrollmentId: id(61), candidateId: id(71), smeAssignmentId: id(72), taskId: id(80), recordId: id(85), validationRunId: id(86) });

    // Paid calls: the extraction's reported cost, plus estimates for the model calls.
    expect(r.paidCalls).toEqual([
      { kind: 'policy-extraction', provider: 'llamaextract', count: 1, usd: 0.09, source: 'reported' },
      { kind: 'suitability-assessment', provider: 'gemini:gemini-3.8-flash', count: 1, usd: 0.01, source: 'estimate' },
      { kind: 'authoring-assistant', provider: 'gemini:gemini-3.8-flash', count: 1, usd: 0.005, source: 'estimate' },
      { kind: 'similarity-embedding', provider: 'vertex-embeddings', count: 1, usd: 0.0001, source: 'estimate' },
    ]);
    expect(r.totalPaidCalls).toBe(4);
    expect(r.estimatedCostUsd).toBe(0.1051);

    // Its own project on the newest published KYC template, never anyone else's.
    const created = api.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/projects')!;
    expect(created.body).toMatchObject({ name: `${SMOKE_PREFIX}2026-11-14 09:30`, templateId: id(11), authoringExperience: 'BOTH', reviewRoute: 'SME_PM', distinctTarget: 1, maxPerExpert: 1 });
    const projectPaths = api.calls.map((c) => c.path).filter((x) => x.includes('/projects/') && !x.startsWith('/api/v1/me/'));
    expect(projectPaths.every((x) => x.includes(P))).toBe(true);

    // The policy is the short synthetic fixture, uploaded as a Markdown file.
    expect(api.calls.find((c) => c.path.endsWith('/policy/documents'))!.body).toEqual({ form: { fields: expect.objectContaining({ title: expect.stringContaining('SYNTHETIC') }), file: 'qa-smoke-policy.md' } });
    expect(defaultPolicyMarkdown()).toMatch(/SYNTHETIC/);
    expect(defaultPolicyMarkdown().length).toBeLessThan(3000);

    // Every human decision is made by the named seeded Reviewer through the normal routes.
    const decisions = api.calls.filter((c) => /\/decision$/.test(c.path) && !c.path.includes('/conversation/'));
    expect(decisions.map((c) => [c.who, c.path])).toEqual([
      ['reviewer', `/api/v1/review/enrollments/${id(61)}/decision`],
      ['reviewer', `/api/v1/review/tasks/${id(80)}/decision`],
    ]);
    expect(decisions[0]!.body).toMatchObject({ outcome: 'SELECTED' });
    expect(decisions[1]!.body).toMatchObject({ decision: 'ACCEPT', checklist: { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true } });
    // The AI proposal is discarded; the author keeps their own text and declares authorship.
    expect(api.calls.find((c) => c.path.endsWith('/conversation/decision'))).toMatchObject({ who: 'sme', body: { accept: false } });

    // The saved case cites the rule this run reviewed and published, and names the slot's state.
    const saved = api.state.saved as { sections: { S1: { scope: string }; S4: { policies: { ruleId: string; ruleVersion: string }[] } } };
    expect(saved.sections.S4.policies).toEqual([expect.objectContaining({ ruleId: 'NW-3.1', ruleVersion: id(53) })]);
    expect(saved.sections.S1.scope).toBe('US-IL');

    // In-progress project: paused, then cancelled.
    expect(api.state.cancelled).toBe(true);
    expect(api.calls.filter((c) => /\/(pause|cancel)$/.test(c.path)).map((c) => c.path)).toEqual([`/api/v1/projects/${P}/pause`, `/api/v1/projects/${P}/cancel`]);

    // Never prints a secret.
    const text = JSON.stringify(r) + logs.join('\n');
    for (const pw of Object.values(PW)) expect(text).not.toContain(pw);
  });

  it('extraction with mostly QUOTE_MISMATCH fails the policy step; dependent steps are SKIPPED; the rest still run', async () => {
    const api = fakeApi({ citations: ['QUOTE_MISMATCH', 'QUOTE_MISMATCH', 'RESOLVED'] });
    const r = await qaSmoke(options(api.http), log);
    expect(r.ok).toBe(false);
    expect(statuses(r)).toEqual({ health: 'PASS', 'sign-in': 'PASS', project: 'PASS', policy: 'FAIL', staffing: 'PASS', authoring: 'SKIPPED', review: 'SKIPPED', export: 'SKIPPED', cleanup: 'PASS' });
    const policy = r.steps.find((x) => x.name === 'policy')!;
    expect(policy.error).toMatch(/Only 33% of 3 citations are RESOLVED .*QUOTE_MISMATCH/);
    expect(r.steps.find((x) => x.name === 'authoring')!.reason).toBe('needs policy');
    expect(r.steps.find((x) => x.name === 'review')!.reason).toBe('needs authoring');
    expect(api.state.cancelled).toBe(true);
  });

  it('a failed extraction job reports the provider error', async () => {
    const api = fakeApi({ extraction: { status: 'FAILED', candidateCount: 0, error: 'LlamaExtract: project not found' } });
    const r = await qaSmoke(options(api.http), log);
    expect(r.steps.find((x) => x.name === 'policy')).toMatchObject({ status: 'FAIL', error: expect.stringContaining('is FAILED: LlamaExtract: project not found') });
    // The failed job still counts as a paid call attempt.
    expect(r.paidCalls[0]).toMatchObject({ kind: 'policy-extraction', count: 1 });
  });

  it('a failed authoring-assistant run fails authoring with the model error', async () => {
    const r = await qaSmoke(options(fakeApi({ chat: 'FAILED' }).http), log);
    expect(r.steps.find((x) => x.name === 'authoring')).toMatchObject({ status: 'FAIL', error: expect.stringMatching(/assistant run .* FAILED: Vertex 429/) });
    expect(statuses(r)).toMatchObject({ review: 'SKIPPED', export: 'SKIPPED', cleanup: 'PASS' });
  });

  it('when export validation would call Anvil, export is SKIPPED with the reason and the run still passes', async () => {
    const api = fakeApi({ validator: 'anvil-discovery+praxis-precheck' });
    const r = await qaSmoke(options(api.http), log);
    expect(r.ok).toBe(true);
    expect(r.steps.find((x) => x.name === 'export')).toMatchObject({ status: 'SKIPPED', reason: expect.stringContaining('would call Anvil') });
    expect(api.calls.some((c) => c.path.endsWith('/validate'))).toBe(false);
  });

  it('an unhealthy API skips everything after health; nothing is created', async () => {
    const api = fakeApi({ readyz: 503 });
    const r = await qaSmoke(options(api.http), log);
    expect(r.ok).toBe(false);
    expect(statuses(r)).toEqual({ health: 'FAIL', 'sign-in': 'SKIPPED', project: 'SKIPPED', policy: 'SKIPPED', staffing: 'SKIPPED', authoring: 'SKIPPED', review: 'SKIPPED', export: 'SKIPPED', cleanup: 'SKIPPED' });
    expect(r.steps.find((x) => x.name === 'cleanup')!.reason).toBe('no project was created');
    expect(api.calls).toHaveLength(1);
    expect(r.totalPaidCalls).toBe(0);
  });

  it('a missing secret fails sign-in by name; an error that echoes a password is redacted', async () => {
    const r1 = await qaSmoke(options(fakeApi().http, { reviewerPassword: undefined }), log);
    expect(r1.steps.find((x) => x.name === 'sign-in')).toMatchObject({ status: 'FAIL', error: 'QA_SEED_REVIEWER_PASSWORD is not set' });
    const r2 = await qaSmoke(options(fakeApi({ echoPasswordOnLogin: true }).http), log);
    const err = r2.steps.find((x) => x.name === 'sign-in')!.error!;
    expect(err).toContain('[redacted]');
    expect(JSON.stringify(r2)).not.toContain(PW.reviewer);
  });

  it('every step depends only on earlier steps', () => {
    for (const [i, n] of STEPS.entries()) for (const d of NEEDS[n]) expect(STEPS.indexOf(d)).toBeLessThan(i);
  });

  it('options: a fresh synthetic SME per run, the seeded reviewer, timeouts from the environment', () => {
    const o = optionsFromEnv({ QA_SMOKE_EXTRACTION_TIMEOUT_SECONDS: '60' }, 'demo', fakeApi().http, new Date('2026-11-14T09:30:05Z'));
    expect(o.smeEmail).toBe('smoke-20261114093005@praxis.test');
    expect(o.reviewerEmail).toBe('reviewer01@praxis.test');
    expect(o.workflowName).toBe('KYC onboarding and refresh');
    expect(o.timeouts.extractionMs).toBe(60_000);
    expect(() => optionsFromEnv({ QA_SMOKE_CHAT_TIMEOUT_SECONDS: 'x' }, 'demo', fakeApi().http)).toThrow(/QA_SMOKE_CHAT_TIMEOUT_SECONDS/);
  });

  it('buildOutput binds the published rule and the slot case; it refuses a form it cannot fill', () => {
    const rule = { ruleId: id(52), ruleKey: null, versionId: id(53), quote: 'q' };
    const out = buildOutput({ template: { profileId: 'kyc-account-opening' }, input: { slot: { tags: {}, case: { field: 'state', source: 'S1.scope', value: 'US-TX' } } } }, rule) as typeof GOLDEN_KYC_EXAMPLE;
    expect((out.sections as Record<string, Record<string, unknown>>).S1!.scope).toBe('US-TX');
    expect((out.sections as Record<string, { policies?: unknown[] }>).S4!.policies).toEqual([expect.objectContaining({ ruleId: id(52), ruleVersion: id(53), quote: 'q' })]);
    // The shared golden case itself is untouched.
    expect(JSON.stringify(GOLDEN_KYC_EXAMPLE)).toContain('{{GB-01}}');
    expect(() => buildOutput({ definition: 'kyc', template: { workflow: 'KYC onboarding and refresh', profileId: null, profile: null }, input: {} }, rule)).toThrow(/No synthetic case builder/);
  });
});

describe('qa-smoke on the KYC v6 template shape (per-state reusable form, Anvil-defined rubric, no worked example)', () => {
  const packet = JSON.parse(readFileSync(new URL('./fixtures/kyc-reusable/proposal.json', import.meta.url), 'utf8'));
  const profile = packet.authoring.profile;
  const spec = { schemaVersion: JOINT_TEMPLATE_SPEC, execution: packet.execution };
  const rule = { ruleId: 'r-1', ruleKey: 'R-NW-3.1', versionId: 'rv-1', quote: 'must' };
  const task = { definition: 'golden-kyc-reusable-v1', template: { profileId: profile.profileId, profile }, input: { slot: { case: { field: 'governing_state', source: 'S1.governingState', value: 'TX' }, tags: {} } } };

  it('fills every pick list with a value the form allows and names the slot state', () => {
    const out = buildOutput(task, rule) as { sections: Record<string, Record<string, unknown>> };
    expect(out.sections.S3!.environment).toBe('golden_kyc_openenv');
    expect(out.sections.S1!.governingState).toBe('TX');
    const allowedTools = profile.sections.find((x: { key: string }) => x.key === 'S3').fields.find((f: { key: string }) => f.key === 'tools').options.map((o: { value: string }) => o.value);
    for (const tool of out.sections.S3!.tools as string[]) expect(allowedTools).toContain(tool);
  });

  it('binds the rubric to the template criterion IDs and evaluators from the pre-check, until every Anvil check passes', () => {
    let out = buildOutput(task, rule);
    const failing = (o: Record<string, unknown>) => anvilSpecChecks(spec, o).filter((c) => !c.ok).map((c) => c.id);
    expect(failing(out)).toContain('anvil.evaluator-binding');
    let rounds = 0;
    for (let next = bindCriteriaFromChecks(out, anvilSpecChecks(spec, out)); next; next = bindCriteriaFromChecks(out, anvilSpecChecks(spec, out))) {
      out = next;
      rounds++;
    }
    expect(rounds).toBe(2);
    expect(failing(out)).toEqual([]);
    const criteria = (out.sections as { S7: { criteria: { id: string; evaluatorKind: string; evaluatorVersion: string; weight: number; critical: boolean; name: string }[] } }).S7.criteria;
    expect(criteria.map((c) => [c.id, c.evaluatorKind, c.evaluatorVersion])).toEqual(packet.execution.evaluators.map((e: { criterion_id: string; capability: { id: string; version: string } }) => [e.criterion_id, e.capability.id, e.capability.version]));
    expect(criteria.filter((c) => c.critical)).toHaveLength(1);
    expect(criteria.every((c) => c.name.startsWith('Synthetic QA smoke'))).toBe(true);
  });

  it('splits weights to exactly 100 with two decimals for any number of criteria, and reports a pre-check it cannot read', () => {
    const three = bindCriteriaFromChecks({ sections: {} }, [{ id: 'anvil.evaluator-binding', ok: false, message: 'Criteria C1 have no evaluator in this template; use the template’s criterion IDs (a, b, c)' }]) as { sections: { S7: { criteria: { weight: number }[] } } };
    expect(three.sections.S7.criteria.map((c) => c.weight)).toEqual([33.34, 33.33, 33.33]);
    expect(bindCriteriaFromChecks({ sections: {} }, [{ id: 'anvil.evaluator-binding', ok: true, message: '' }])).toBeNull();
    expect(() => bindCriteriaFromChecks({ sections: {} }, [{ id: 'anvil.evaluator-binding', ok: false, message: 'something else' }])).toThrow(/did not name the template's criterion IDs/);
  });
});
