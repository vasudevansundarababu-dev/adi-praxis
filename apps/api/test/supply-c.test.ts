import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ONBOARDING_ITEMS, ONBOARDING_VERSION } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryEmailSender } from '../src/lib/email';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { emitEvent } from '../src/outbox/outbox';
import { MockPayoutProvider } from '../src/pay/provider';
import { previousWeek } from '../src/pay/payruns';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';

describe('M10c payments: earnings, pay runs, payouts, reconciliation and partner fees (docs/SME-SUPPLY.md section 8)', () => {
  let app: FastifyInstance;
  const email = new MemoryEmailSender();
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig({ SME_SUPPLY_ENABLED: 'true' });
  const payouts = new MockPayoutProvider('test-payout-webhook-secret');
  const handlers = defaultHandlers({ config });
  let clientId: string;
  let admin: string;
  let adminId: string;
  let pm: string;
  let finance: string;
  let finance2: string;

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, selectionGate: stubSelectionGate, email, payouts });
  });
  beforeEach(async () => {
    await resetDb();
    email.sent.length = 0;
    payouts.settlementOverride = null;
    payouts.payments.clear();
    payouts.payees.clear();
    payouts.batches.clear();
    const { client, admin: a } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    adminId = a.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    finance = await login(app, (await createUser(clientId, ['FINANCE'])).email);
    finance2 = await login(app, (await createUser(clientId, ['FINANCE'])).email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const post = (cookie: string, url: string, payload: unknown = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  const put = (cookie: string, url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  const webhook = (event: Parameters<MockPayoutProvider['signed']>[0], secret?: string) => {
    const { body, headers } = payouts.signed(event, secret);
    return app.inject({ method: 'POST', url: '/api/v1/integrations/trolley/webhook', headers, payload: body });
  };
  const drain = async (name: string) => {
    for (const ev of await db.outboxEvent.findMany({ where: { name: name as never }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, handlers, ev.id);
  };

  async function supplyProject() {
    const domainId = (await post(admin, '/domains', { name: `Banking ${randomUUID().slice(0, 4)}` })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: 'KYC onboarding', primaryWork: 'x', verificationCriteria: 'x', humanGate: 'x', defaultTptMinutes: 60, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    await post(admin, `/templates/${t.id}/publish`);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author synthetic KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'USD', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { templateId: t.id, name: `P ${randomUUID().slice(0, 6)}`, distinctTarget: 8, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-11-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['IN', 'GB'], required: false }] })).json();
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/match`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/opportunity/publish`)).statusCode).toBe(200);
    await post(pm, `/projects/${p.id}/sme-supply`, { enabled: true });
    return p.id as string;
  }

  async function livePartner() {
    const p = (await post(admin, '/partners', { name: `Partner ${randomUUID().slice(0, 4)}`, businessVerification: 'VERIFIED', allowedDomains: ['banking'], allowedTiers: ['ANNOTATOR', 'REVIEWER_SME', 'EXPERT'] })).json();
    const userEmail = `ops.${randomUUID().slice(0, 6)}@partner.example`;
    await post(admin, `/partners/${p.id}/users`, { email: userEmail, name: 'Ops Lead', password: 'partner-password-1', requirePasswordChange: false });
    const res = await app.inject({ method: 'POST', url: '/api/v1/partner-portal/login', payload: { email: userEmail, password: 'partner-password-1' } });
    const portal = `praxis_partner=${res.cookies.find((c) => c.name === 'praxis_partner')!.value}`;
    const c = (await post(portal, '/partner-portal/clients', { environment: 'LIVE' })).json();
    const tok = await app.inject({ method: 'POST', url: '/partner/v1/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `grant_type=client_credentials&client_id=${c.clientId}&client_secret=${c.clientSecret}` });
    return { id: p.id as string, portal, token: tok.json().access_token as string };
  }

  async function rateCard(currency: 'USD' | 'INR' = 'USD', perTask: Record<string, string> = { AUTHORING: '40.00', ANNOTATION: '8.00' }) {
    const res = await post(finance, '/rate-cards', { name: `KYC ${currency}`, currency, perTask });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }

  async function requisition(projectId: string, partnerId: string, extra: object = {}) {
    const r = (await post(pm, '/requisitions', { projectId, title: 'KYC authors (India)', summary: 'Author KYC cases.', domain: 'banking', tier: 'ANNOTATOR', headcount: 10, languages: ['en'], jurisdictions: ['IN'], minimumRequirements: { minYears: 2, qualifications: [], licenceRequired: false }, allowedPartnerIds: [partnerId], maxPerPartner: 50, ...extra })).json();
    expect(r.id, JSON.stringify(r)).toBeTruthy();
    expect((await post(pm, `/requisitions/${r.id}/transition`, { to: 'OPEN' })).statusCode).toBe(200);
    return r.id as string;
  }

  const mobile = () => `+91 9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  /** A person supplied by the partner, invited, signed in and (as a fixture) selected, with a matching record. */
  async function sme(requisitionId: string, partner: { token: string }) {
    const who = { partnerRef: `ref-${randomUUID().slice(0, 8)}`, name: 'Priya Raman', email: `priya.${randomUUID().slice(0, 6)}@example.test`, phone: mobile(), country: 'IN', experienceSummary: 'Four years of KYC onboarding review at a retail bank, including beneficial ownership checks.', experienceYears: 4, qualifications: ['CAMS'], languages: ['en'], partnerTrainingAttestation: true, candidateConsent: true };
    const sent = email.sent.length;
    const sub = await app.inject({ method: 'POST', url: `/partner/v1/requisitions/${requisitionId}/candidates`, headers: { authorization: `Bearer ${partner.token}`, 'idempotency-key': randomUUID() }, payload: who });
    expect(sub.statusCode, sub.body).toBe(201);
    const token = email.sent.slice(sent).find((m) => m.to === who.email)!.text.match(/\/partner-invite\/(\S+)/)![1]!;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${who.email}`, email: who.email, name: who.name }), adultAttested: true } });
    const cookie = `praxis_candidate=${res.cookies.find((c) => c.name === 'praxis_candidate')!.value}`;
    const smeUserId = res.json().id as string;
    const red = await post(cookie, '/me/partner-invites/redeem', { token });
    expect(red.statusCode, red.body).toBe(200);
    const enrollmentId = red.json().enrollmentId as string;
    const last = await db.profileVersion.findFirst({ where: { smeUserId }, orderBy: { version: 'desc' } });
    const pv = await db.profileVersion.create({ data: { clientId, smeUserId, enrollmentId, version: (last?.version ?? 0) + 1, data: {}, contentHash: randomUUID(), submittedAt: new Date() } });
    const d = await db.selectionDecision.create({ data: { clientId, enrollmentId, reviewerId: adminId, outcome: 'SELECTED', reasons: [], profileVersionId: pv.id, criteriaRef: {} } });
    await db.qualificationScope.create({ data: { clientId, enrollmentId, selectionDecisionId: d.id, domain: 'Banking', specialty: 'KYC', jurisdictions: ['IN'], languages: ['en'], contributionRoles: ['TASK_AUTHOR'] } });
    await db.enrollment.update({ where: { id: enrollmentId }, data: { status: 'SELECTED', profileVersionId: pv.id } });
    await db.onboardingChecklist.create({ data: { clientId, enrollmentId, checklistVersion: ONBOARDING_VERSION, items: ONBOARDING_ITEMS.map((i) => i.key), status: 'NOT_STARTED' } });
    const candidate = await db.candidate.upsert({ where: { smeUserId }, create: { clientId, smeUserId, country: 'IN' }, update: {} });
    return { cookie, smeUserId, enrollmentId, candidateId: candidate.id, email: who.email };
  }
  type Sme = Awaited<ReturnType<typeof sme>>;

  /** A task by this SME that a Validator accepted (FLOW 3's review is tested in tasks.test.ts); emits `task.accepted`. */
  async function acceptedTask(projectId: string, s: Sme, taskType: 'AUTHORING' | 'ANNOTATION' = 'AUTHORING', at?: Date) {
    const t = await db.taskInstance.create({ data: { clientId, projectId, taskType, assignedToId: s.candidateId, status: 'ACCEPTED' } });
    const ev = await db.$transaction((tx) => emitEvent(tx, clientId, { name: 'task.accepted', aggregateType: 'TaskInstance', aggregateId: t.id, payload: { taskId: t.id, projectId } }));
    if (at) await db.outboxEvent.update({ where: { id: ev.id }, data: { createdAt: at } });
    await drain('task.accepted');
    return t.id;
  }

  async function readyPayee(s: Sme) {
    const link = await post(s.cookie, '/me/payee/onboarding-link');
    expect(link.statusCode, link.body).toBe(200);
    expect(link.json().url).toContain('/payee/mock-onboarding');
    const p = await db.payee.findUniqueOrThrow({ where: { smeUserId: s.smeUserId } });
    expect((await webhook(payouts.payeeEvent(p.payeeRef!, 'READY'))).statusCode).toBe(200);
  }

  /** Project + partner + DIRECT requisition with a USD rate card. */
  async function setup(extra: object = {}) {
    const projectId = await supplyProject();
    const partner = await livePartner();
    const r = await requisition(projectId, partner.id, extra);
    const card = await rateCard();
    expect((await put(pm, `/requisitions/${r}/rate-card`, { rateCardId: card })).statusCode).toBe(200);
    return { projectId, partner, r, card };
  }

  /** A day inside last week's pay-run window. */
  const lastWeek = () => new Date(previousWeek().periodStart.getTime() + 86_400_000);

  describe('feature flag', () => {
    it('with the flag off no payment route or handler exists', async () => {
      const off = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate });
      for (const [method, url] of [['GET', '/api/v1/pay-runs'], ['POST', '/api/v1/rate-cards'], ['GET', '/api/v1/me/earnings'], ['POST', '/api/v1/integrations/trolley/webhook']] as const) {
        expect((await off.inject({ method, url, payload: {} })).statusCode, url).toBe(404);
      }
      await off.close();
      expect(defaultHandlers({ config: testConfig() }).for('task.accepted').map((h) => h.name)).not.toContain('m10.task-earning');
      expect(handlers.for('cert.certified').map((h) => h.name)).toEqual(['m10.partner-fee']);
    });
  });

  describe('earnings ledger', () => {
    it('approving a task creates exactly one earning entry at the rate-card price; replaying the event creates none', async () => {
      const { projectId, partner, r } = await setup();
      const s = await sme(r, partner);
      const taskId = await acceptedTask(projectId, s);
      const entries = await db.earningEntry.findMany({ where: { smeUserId: s.smeUserId } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ kind: 'TASK', currency: 'USD', sourceType: 'TaskInstance', sourceId: taskId, requisitionId: r, rateCardVersion: 1 });
      expect(entries[0]!.amount.toFixed(2)).toBe('40.00');
      // Replay: the same event again, and a second event for the same task.
      await db.outboxEvent.updateMany({ where: { name: 'task.accepted' }, data: { dispatchedAt: null } });
      await drain('task.accepted');
      await db.$transaction((tx) => emitEvent(tx, clientId, { name: 'task.accepted', aggregateType: 'TaskInstance', aggregateId: taskId, payload: { taskId, projectId } }));
      await drain('task.accepted');
      expect(await db.earningEntry.count({ where: { smeUserId: s.smeUserId } })).toBe(1);
      // A new rate-card version applies only once linked; old entries keep their version.
      const v2 = await post(finance, '/rate-cards', { name: 'KYC USD', currency: 'USD', perTask: { AUTHORING: '45.00' } });
      expect(v2.json().version).toBe(2);
      await put(pm, `/requisitions/${r}/rate-card`, { rateCardId: v2.json().id });
      await acceptedTask(projectId, s, 'AUTHORING');
      expect((await db.earningEntry.findMany({ where: { smeUserId: s.smeUserId }, orderBy: { createdAt: 'asc' } })).map((e) => [e.amount.toFixed(2), e.rateCardVersion])).toEqual([['40.00', 1], ['45.00', 2]]);
      // Partner-paid requisitions earn nothing here.
      const r2 = await requisition(projectId, partner.id, { payRoute: 'VIA_PARTNER' });
      await put(pm, `/requisitions/${r2}/rate-card`, { rateCardId: v2.json().id });
      const other = await sme(r2, partner);
      await acceptedTask(projectId, other);
      expect(await db.earningEntry.count({ where: { smeUserId: other.smeUserId } })).toBe(0);
      expect(await db.auditEvent.count({ where: { action: 'earning.recorded' } })).toBe(2);
      // The SME sees their earnings.
      const mine = (await get(s.cookie, '/me/earnings')).json();
      expect(mine.balance.USD).toMatchObject({ earned: '85.00', unpaid: '85.00' });
    });

    it('earning entries cannot be updated or deleted (database-enforced); a correction is a reversing entry', async () => {
      const { projectId, partner, r } = await setup();
      const s = await sme(r, partner);
      await acceptedTask(projectId, s);
      const e = await db.earningEntry.findFirstOrThrow({ where: { smeUserId: s.smeUserId } });
      await expect(db.earningEntry.update({ where: { id: e.id }, data: { amount: 1 } })).rejects.toThrow();
      await expect(db.earningEntry.delete({ where: { id: e.id } })).rejects.toThrow();
      await expect(db.$executeRaw`TRUNCATE "EarningEntry"`).rejects.toThrow();
      expect((await db.earningEntry.findUniqueOrThrow({ where: { id: e.id } })).amount.toFixed(2)).toBe('40.00');
      // Only Finance (or an Admin) reverses; the reversal is a new, negative entry.
      expect((await post(pm, `/earnings/${e.id}/reverse`, { reason: 'Task was a duplicate.' })).statusCode).toBe(403);
      const rev = await post(finance, `/earnings/${e.id}/reverse`, { reason: 'Task was a duplicate.' });
      expect(rev.statusCode, rev.body).toBe(201);
      expect(rev.json()).toMatchObject({ kind: 'REVERSAL', amount: '-40.00', reversesId: e.id });
      expect((await post(finance, `/earnings/${e.id}/reverse`, { reason: 'Again, by mistake.' })).json().error).toBe('ALREADY_REVERSED');
      expect((await post(finance, `/earnings/${rev.json().id}/reverse`, { reason: 'Undo the reversal.' })).json().error).toBe('IS_REVERSAL');
      expect((await get(s.cookie, '/me/earnings')).json().balance.USD.earned).toBe('0.00');
      expect(await db.auditEvent.count({ where: { action: 'earning.reversed' } })).toBe(1);
      // Partner fee entries are append-only too.
      await expect(db.$executeRaw`UPDATE "PartnerFeeEntry" SET amount = 0`).resolves.toBe(0); // no rows: the trigger fires per row
      const f = await db.partnerFeeEntry.create({ data: { clientId, partnerId: partner.id, amount: 100, currency: 'USD' } });
      await expect(db.partnerFeeEntry.update({ where: { id: f.id }, data: { amount: 1 } })).rejects.toThrow();
    });
  });

  describe('pay runs', () => {
    it('a pay run cannot be submitted without the required approvals; held items are excluded and reported; small balances carry forward', async () => {
      const { projectId, partner, r } = await setup();
      const ready = await sme(r, partner);
      const notReady = await sme(r, partner);
      const onHold = await sme(r, partner);
      const small = await sme(r, partner);
      await readyPayee(ready);
      await readyPayee(onHold);
      await readyPayee(small);
      for (const s of [ready, notReady, onHold]) await acceptedTask(projectId, s, 'AUTHORING', lastWeek());
      await acceptedTask(projectId, small, 'ANNOTATION', lastWeek()); // USD 8 < USD 10 minimum
      expect((await post(finance, '/pay-holds', { smeUserId: onHold.smeUserId, kind: 'DISPUTE', reason: 'Client disputes two tasks.' })).statusCode).toBe(201);

      const built = await post(finance, '/pay-runs', {});
      expect(built.statusCode, built.body).toBe(201);
      const run = built.json();
      expect(run.periodStart).toBe(previousWeek().periodStart.toISOString());
      expect(run.totals).toEqual({ USD: '40.00' });
      const byUser = Object.fromEntries(run.items.map((i: { smeUserId: string }) => [i.smeUserId, i]));
      expect(byUser[ready.smeUserId]).toMatchObject({ status: 'PENDING', amount: '40.00' });
      expect(byUser[notReady.smeUserId]).toMatchObject({ status: 'HELD', holdReason: 'Payee not ready (NOT_STARTED)' });
      expect(byUser[onHold.smeUserId].holdReason).toContain('Dispute');
      expect(byUser[small.smeUserId]).toBeUndefined();
      expect(run.report.held).toHaveLength(2);
      expect(run.report.carried).toEqual([expect.objectContaining({ smeUserId: small.smeUserId, amount: '8.00' })]);
      expect((await post(finance, '/pay-runs', {})).json().error).toBe('PAY_RUN_EXISTS');

      // Submit, approve out of order, and approve by a PM: all refused.
      expect((await post(finance, `/pay-runs/${run.id}/submit`)).json().error).toBe('APPROVALS_REQUIRED');
      expect((await post(finance, `/pay-runs/${run.id}/approve`)).json().error).toBe('NOT_CONFIRMED');
      expect((await post(finance, `/pay-runs/${run.id}/confirm`)).statusCode).toBe(403);
      expect((await post(pm, `/pay-runs/${run.id}/confirm`)).statusCode).toBe(200);
      expect((await post(pm, `/pay-runs/${run.id}/approve`)).statusCode).toBe(403);
      expect((await post(pm, `/pay-runs/${run.id}/submit`)).statusCode).toBe(403);
      expect((await post(finance, `/pay-runs/${run.id}/submit`)).json().error).toBe('APPROVALS_REQUIRED');
      const ok = await post(finance, `/pay-runs/${run.id}/approve`);
      expect(ok.json().status).toBe('APPROVED');
      expect((await post(finance, `/pay-runs/${run.id}/approve`)).json().error).toBe('NOT_AWAITING_APPROVAL');
      const approval = await db.auditEvent.findFirstOrThrow({ where: { action: 'pay_run.approved', entityId: run.id } });
      expect(approval.after).toMatchObject({ singleApprover: true, needed: 1 });

      const sub = await post(finance, `/pay-runs/${run.id}/submit`);
      expect(sub.statusCode, sub.body).toBe(200);
      expect(sub.json().status).toBe('SUBMITTED');
      const items = sub.json().items;
      expect(items.filter((i: { status: string }) => i.status === 'SUBMITTED')).toHaveLength(1);
      expect(items.filter((i: { status: string }) => i.status === 'HELD')).toHaveLength(2);
      expect(payouts.payments.size).toBeGreaterThanOrEqual(1);
      // Submitting again pays nobody twice.
      const before = payouts.payments.size;
      expect((await post(finance, `/pay-runs/${run.id}/submit`)).json().status).toBe('SUBMITTED');
      expect(payouts.payments.size).toBe(before);

      // The small balance and the held amounts carry into next week's run.
      const next = await post(finance, '/pay-runs', { periodStart: previousWeek(new Date(Date.now() + 7 * 86_400_000)).periodStart.toISOString().slice(0, 10) });
      expect(next.statusCode, next.body).toBe(201);
      expect(next.json().report.carried.map((c: { smeUserId: string }) => c.smeUserId)).toContain(small.smeUserId);
      expect(next.json().items.map((i: { smeUserId: string }) => i.smeUserId).sort()).toEqual([notReady.smeUserId, onHold.smeUserId].sort());
      expect(next.json().items.map((i: { smeUserId: string }) => i.smeUserId)).not.toContain(ready.smeUserId);
      const actions = (await db.auditEvent.findMany({ where: { entityType: { in: ['PayRun', 'PayHold'] } } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['pay_hold.placed', 'pay_run.built', 'pay_run.confirmed', 'pay_run.approved', 'pay_run.submitted']));
    });

    it('above the configured amount a second, different Finance approver is needed; an approver who is paid in the run is refused', async () => {
      const strict = await buildApp({ config: testConfig({ SME_SUPPLY_ENABLED: 'true', PAYRUN_SECOND_APPROVAL_ABOVE: '30' }), db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, selectionGate: stubSelectionGate, email, payouts });
      const { projectId, partner, r } = await setup();
      const s = await sme(r, partner);
      await readyPayee(s);
      await acceptedTask(projectId, s, 'AUTHORING', lastWeek());
      const run = (await post(finance, '/pay-runs', {})).json();
      await post(pm, `/pay-runs/${run.id}/confirm`);
      const call = (cookie: string) => strict.inject({ method: 'POST', url: `/api/v1/pay-runs/${run.id}/approve`, headers: { cookie, ...idem() } });
      expect((await call(finance)).json().status).toBe('CONFIRMED');
      expect((await call(finance)).json().error).toBe('ALREADY_APPROVED');
      expect((await call(finance2)).json().status).toBe('APPROVED');
      expect((await db.auditEvent.findFirstOrThrow({ where: { action: 'pay_run.approved' } })).after).toMatchObject({ singleApprover: false, needed: 2 });

      // A Finance user who is also an SME in the run cannot approve it.
      const run2 = (await post(finance, '/pay-runs', { periodStart: previousWeek(new Date(Date.now() + 7 * 86_400_000)).periodStart.toISOString().slice(0, 10) })).json();
      const s2 = await sme(r, partner);
      await readyPayee(s2);
      await acceptedTask(projectId, s2, 'AUTHORING', new Date(run2.periodStart));
      await post(finance, `/pay-runs/${run2.id}/cancel`, { reason: 'Rebuild with late entries.' });
      const rebuilt = (await post(finance, '/pay-runs', { periodStart: run2.periodStart.slice(0, 10) })).json();
      expect(rebuilt.items.map((i: { smeUserId: string }) => i.smeUserId)).toContain(s2.smeUserId);
      await post(pm, `/pay-runs/${rebuilt.id}/confirm`);
      const selfPaid = await login(app, (await createUser(clientId, ['FINANCE'], s2.email)).email);
      expect((await post(selfPaid, `/pay-runs/${rebuilt.id}/approve`)).json().error).toBe('APPROVER_IS_PAYEE');
      await strict.close();
    });
  });

  describe('payout provider webhooks and reconciliation', () => {
    async function submitted() {
      const { projectId, partner, r } = await setup();
      const smes = [];
      for (let i = 0; i < 3; i++) {
        const s = await sme(r, partner);
        await readyPayee(s);
        await acceptedTask(projectId, s, 'AUTHORING', lastWeek());
        smes.push(s);
      }
      const run = (await post(finance, '/pay-runs', {})).json();
      await post(pm, `/pay-runs/${run.id}/confirm`);
      await post(finance, `/pay-runs/${run.id}/approve`);
      const sub = (await post(finance, `/pay-runs/${run.id}/submit`)).json();
      return { run: sub, smes, partner };
    }

    it('bad signatures are rejected; duplicates are ignored; statuses reach PAID, FAILED or RETURNED', async () => {
      const { run } = await submitted();
      const [a, b, c] = run.items.map((i: { providerPaymentRef: string }) => i.providerPaymentRef) as [string, string, string];
      // Wrong secret, tampered body, missing signature: 400 and nothing changes.
      expect((await webhook(payouts.settle(a, 'PAID'), 'wrong-secret')).statusCode).toBe(400);
      const { body, headers } = payouts.signed(payouts.settle(a, 'PAID'));
      expect((await app.inject({ method: 'POST', url: '/api/v1/integrations/trolley/webhook', headers, payload: body.replace('PAID', 'FAILED') })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/v1/integrations/trolley/webhook', headers: { 'content-type': 'application/json' }, payload: body })).statusCode).toBe(400);
      expect((await db.payoutItem.findUniqueOrThrow({ where: { providerPaymentRef: a } })).status).toBe('SUBMITTED');
      // Signed events apply once; a repeat is a duplicate.
      const paid = payouts.settle(a, 'PAID');
      expect((await webhook(paid)).json()).toMatchObject({ duplicate: false, outcome: 'applied' });
      expect((await webhook(paid)).json()).toMatchObject({ duplicate: true });
      expect((await webhook(payouts.settle(b, 'FAILED', 'Account closed'))).json().outcome).toBe('applied');
      expect((await webhook(payouts.settle(c, 'PAID'))).json().outcome).toBe('applied');
      expect((await webhook(payouts.settle(c, 'RETURNED', 'Returned by bank'))).json().outcome).toBe('applied');
      // An event from the other mode (live, while we run in test mode) is recorded and ignored.
      expect((await webhook({ ...payouts.settle(b, 'PAID'), livemode: true })).json().outcome).toBe('ignored_mode');
      const items = await db.payoutItem.findMany({ where: { payRunId: run.id } });
      expect(Object.fromEntries(items.map((i) => [i.providerPaymentRef, i.status]))).toEqual({ [a]: 'PAID', [b]: 'FAILED', [c]: 'RETURNED' });
      expect(items.find((i) => i.providerPaymentRef === b)!.failureReason).toBe('Account closed');
      expect(items.find((i) => i.providerPaymentRef === a)!.fx).toMatchObject({ payoutCurrency: 'INR', rate: MockPayoutProvider.USD_INR, payoutAmount: '3320.00' });
      expect((await db.payRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('COMPLETED');
      expect(await db.payoutProviderEvent.count({ where: { type: { startsWith: 'payment' } } })).toBe(5);
      const actions = (await db.auditEvent.findMany({ where: { entityType: 'PayoutItem' } })).map((x) => x.action);
      expect(actions.sort()).toEqual(['payout.failed', 'payout.paid', 'payout.paid', 'payout.returned']);
      // Failed and returned money is owed again: it goes into the next run.
      const next = (await post(finance, '/pay-runs', { periodStart: previousWeek(new Date(Date.now() + 7 * 86_400_000)).periodStart.toISOString().slice(0, 10) })).json();
      expect(next.items).toHaveLength(2);
    });

    it('the daily reconciliation report lists every mismatch as an exception for Finance', async () => {
      const { run } = await submitted();
      const [a, b, c] = run.items.map((i: { providerPaymentRef: string }) => i.providerPaymentRef) as [string, string, string];
      for (const ref of [a, b, c]) await webhook(payouts.settle(ref, 'PAID'));
      // The provider's report: `a` right, `b` with another amount, `c` missing, plus a payment we never made.
      payouts.settlementOverride = (_day, lines) => [...lines.filter((l) => l.paymentRef !== c).map((l) => (l.paymentRef === b ? { ...l, amount: '39.00' } : l)), { paymentRef: 'P-unknown-1', amount: '12.00', currency: 'USD', status: 'PAID' }];
      const today = new Date().toISOString().slice(0, 10);
      const res = await post(finance, '/payout-reconciliation', { date: today });
      expect(res.statusCode, res.body).toBe(200);
      const kinds = res.json().mismatches.map((m: { kind: string; paymentRef: string }) => `${m.kind}:${m.paymentRef}`).sort();
      expect(kinds).toEqual([`AMOUNT_MISMATCH:${b}`, `MISSING_IN_REPORT:${c}`, 'UNKNOWN_PAYMENT:P-unknown-1'].sort());
      const open = (await get(finance, '/payout-exceptions')).json().items;
      expect(open).toHaveLength(3);
      // Running it again adds nothing; resolving closes one.
      expect((await post(finance, '/payout-reconciliation', { date: today })).json().created).toBe(0);
      expect((await post(finance, `/payout-exceptions/${open[0].id}/resolve`, { note: 'Bank fee; provider confirmed.' })).statusCode).toBe(200);
      expect((await get(finance, '/payout-exceptions')).json().items).toHaveLength(2);
      expect((await get(pm, '/payout-exceptions')).statusCode).toBe(403);
      expect(await db.auditEvent.count({ where: { action: 'payout.exception_opened' } })).toBe(3);
      expect(await db.auditEvent.count({ where: { action: 'payout.reconciled' } })).toBe(2);
    });
  });

  describe('payee set-up on the C07 checklist', () => {
    it('with direct pay the checklist cannot complete until the payee is READY; with partner pay no payee is needed', async () => {
      const { partner, r, projectId } = await setup();
      const s = await sme(r, partner);
      const view = async (c = s) => (await get(c.cookie, `/me/onboarding?enrollmentId=${c.enrollmentId}`)).json();
      const ack = async (c: Sme, itemKey: string, extra: object = {}) => {
        const item = (await view(c)).items.find((i: { key: string }) => i.key === itemKey);
        return post(c.cookie, '/me/onboarding/acknowledgements', { enrollmentId: c.enrollmentId, itemKey, ...(item.terms ? { termsHash: item.terms.sha256 } : {}), ...extra });
      };
      const standard = async (c: Sme) => {
        for (const key of ['confirm_scope', 'terms:contributor', 'terms:confidentiality_ip', 'terms:data_use', 'guidance']) expect((await ack(c, key)).statusCode).toBe(200);
        expect((await ack(c, 'conflicts', { data: { hasConflicts: false, authorizedToContribute: true } })).statusCode).toBe(200);
        expect((await ack(c, 'preferences', { data: { country: 'IN', languages: [{ language: 'en', level: 'C2' }], timezone: 'Asia/Kolkata', hoursPerWeek: 20, emailNotifications: true } })).statusCode).toBe(200);
      };
      expect((await view()).items.find((i: { key: string }) => i.key === 'payee')).toMatchObject({ done: false, data: { status: 'NOT_STARTED' } });
      await standard(s);
      expect((await view()).status).not.toBe('COMPLETE');
      expect((await ack(s, 'payee')).json().error).toBe('AUTOMATIC_ITEM');
      const link = await post(s.cookie, '/me/payee/onboarding-link');
      expect(link.statusCode, link.body).toBe(200);
      expect((await get(s.cookie, '/me/payee')).json()).toMatchObject({ required: true, status: 'PENDING', provider: 'mock' });
      const p = await db.payee.findUniqueOrThrow({ where: { smeUserId: s.smeUserId } });
      // Nothing about bank accounts or tax is stored: only provider, reference and status.
      expect(Object.keys(p).sort()).toEqual(['clientId', 'createdAt', 'id', 'payeeRef', 'payoutCurrency', 'provider', 'smeUserId', 'status', 'statusReason', 'updatedAt']);
      expect((await webhook(payouts.payeeEvent(p.payeeRef!, 'READY'))).statusCode).toBe(200);
      const v = await view();
      expect(v.status).toBe('COMPLETE');
      expect(v.items.find((i: { key: string }) => i.key === 'payee')).toMatchObject({ done: true });
      expect((await get(s.cookie, '/me/payee')).json()).toMatchObject({ status: 'READY', payoutCurrency: 'INR' });

      const r2 = await requisition(projectId, partner.id, { payRoute: 'VIA_PARTNER' });
      const t = await sme(r2, partner);
      expect((await view(t)).items.map((i: { key: string }) => i.key)).not.toContain('payee');
      expect((await get(t.cookie, '/me/payee')).json()).toMatchObject({ required: false, status: 'NOT_REQUIRED' });
      expect((await post(t.cookie, '/me/payee/onboarding-link')).json().error).toBe('PAYEE_NOT_REQUIRED');
      await standard(t);
      expect((await view(t)).status).toBe('COMPLETE');
    });
  });

  describe('partner fees and statements', () => {
    it('each certified candidate creates one partner fee entry and appears on that month’s statement', async () => {
      const { partner, r } = await setup();
      expect((await put(admin, `/partners/${partner.id}/fee-terms`, { certifiedFee: '150', feeCurrency: 'USD', feeTermsVersion: 'Fees 2026-10' })).statusCode).toBe(200);
      const certify = async () => {
        const s = await sme(r, partner);
        const pkg = await db.guidelinesPackage.upsert({ where: { clientId_domain_taskFamily: { clientId, domain: 'banking', taskFamily: 'KYC' } }, create: { clientId, domain: 'banking', taskFamily: 'KYC', name: 'KYC' }, update: {} });
        const v = (await db.guidelinesVersion.findFirst({ where: { packageId: pkg.id } })) ?? (await db.guidelinesVersion.create({ data: { clientId, packageId: pkg.id, version: 1, major: true, fileName: 'g.md', storageKey: 'k', sha256: 'x', sections: [], createdById: adminId } }));
        // Certification itself is tested in supply-b; here the certified event is the input.
        const c = await db.certification.create({ data: { clientId, smeUserId: s.smeUserId, domain: 'banking', tier: 'ANNOTATOR', versionId: v.id, requisitionId: r, state: 'PASSED', issuedAt: new Date() } });
        await db.$transaction((tx) => emitEvent(tx, clientId, { name: 'cert.certified', aggregateType: 'Certification', aggregateId: c.id, payload: { certificationId: c.id } }));
        return { s, c };
      };
      const one = await certify();
      const two = await certify();
      await drain('cert.certified');
      await db.outboxEvent.updateMany({ where: { name: 'cert.certified' }, data: { dispatchedAt: null } });
      await drain('cert.certified');
      await db.$transaction((tx) => emitEvent(tx, clientId, { name: 'cert.certified', aggregateType: 'Certification', aggregateId: one.c.id, payload: { certificationId: one.c.id } }));
      await drain('cert.certified');
      const fees = await db.partnerFeeEntry.findMany({ where: { partnerId: partner.id } });
      expect(fees).toHaveLength(2);
      expect(fees.map((f) => f.amount.toFixed(2))).toEqual(['150.00', '150.00']);
      expect(fees[0]).toMatchObject({ currency: 'USD', feeTermsVersion: 'Fees 2026-10' });
      expect(new Set(fees.map((f) => f.certificationId))).toEqual(new Set([one.c.id, two.c.id]));

      const period = new Date().toISOString().slice(0, 7);
      const built = await post(finance, '/partner-statements/build', { period });
      expect(built.json().created).toBe(1);
      expect((await post(finance, '/partner-statements/build', { period })).json().created).toBe(0);
      const mine = (await get(partner.portal, '/partner-portal/statements')).json().items;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ period, totals: { USD: '300.00' } });
      expect(mine[0].lines).toHaveLength(2);
      // Partners see their own candidate ids (submission ids), never internal ones.
      const subs = await db.partnerSubmission.findMany({ where: { partnerId: partner.id } });
      expect(mine[0].lines.every((l: { candidateId: string }) => subs.some((s) => s.id === l.candidateId))).toBe(true);
      expect(JSON.stringify(mine)).not.toContain(one.s.smeUserId);
      expect(await db.auditEvent.count({ where: { action: { in: ['partner_fee.recorded', 'partner_statement.issued', 'partner.fee_terms_changed'] } } })).toBe(4);
    });
  });
});
