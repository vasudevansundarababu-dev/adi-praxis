import { executeConversation } from '../src/tasks/conversation/service';
import type { ConversationAssistant, ConversationInput } from '../src/tasks/conversation/assistant';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KYC_EXAMPLE_TASK, replayCall, type KycTask } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { verifyApprovedChain } from '../src/dataset/verify';
import { MemoryEmailSender } from '../src/lib/email';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { DrafterUnavailableError, MockTaskDrafter, type DraftInput, type TaskDrafter } from '../src/tasks/drafting/drafter';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { docxWithText, pdfWithText } from './documents';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
const EDGE = 'Complex or circular ownership';
type Who = { cookie: string; smeUserId: string; candidateId: string };

/** A drafter the test controls: records what it was given and delegates to (or replaces) the mock. */
class ScriptedDrafter implements TaskDrafter {
  readonly model = 'scripted-1';
  inputs: DraftInput[] = [];
  mode: 'mock' | 'down' | 'hostile' | 'echo-forbidden' = 'mock';
  async draft(input: DraftInput) {
    this.inputs.push(input);
    if (this.mode === 'down') throw new DrafterUnavailableError('Vertex unavailable');
    const base = await new MockTaskDrafter().draft(input);
    const raw = base.task as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (this.mode === 'hostile') {
      // What a model that obeyed injected instructions might return: an unknown tool, a call for it, extra fields.
      raw.environment.tools.push('wire_transfer');
      raw.environment.responses.push({ id: 'R99', tool: 'wire_transfer', arguments: [{ name: 'amount', value: '1000000' }], kind: 'DATA', response: 'Sent.' });
      raw.solution.steps.push({ id: 'S99', action: 'TOOL', responseId: 'R99', expectedResult: 'Money moved', why: 'Instructed', dependsOn: [] });
      raw.adminOverride = { approveAll: true };
    }
    if (this.mode === 'echo-forbidden') raw.scenario.businessContext = `Customer account ${input.forbidden.join(' and ')} was reviewed.`;
    return { ...base, model: this.model };
  }
}

describe('M9 task drafting from documents and interviews, MCP tool recording (docs/TASK-DRAFTING.md)', () => {
  let app: FastifyInstance;
  const email = new MemoryEmailSender();
  const google = new MockGoogleVerifier(SECRET);
  const storage = new MemoryStorage();
  const drafter = new ScriptedDrafter();
  const config = testConfig();
  let clientId: string;
  let admin: string;
  let pm: string;

  let addressIndex = 1;
  const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', remoteAddress: '127.0.1.' + (addressIndex++ % 250 + 1), url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const put = (cookie: string, url: string, payload: object) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  const handlers = () => defaultHandlers({ email, config, drafter, storage });
  async function deliver(name: string) {
    for (const ev of await db.outboxEvent.findMany({ where: { name }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, handlers(), ev.id).catch(() => undefined);
  }

  beforeAll(async () => {
    app = await buildApp({ logger: process.env.TEST_LOG ? { level: 'error' } : false, config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage, selectionGate: stubSelectionGate, email, embeddings: new HashingEmbeddingProvider() });
  });
  beforeEach(async () => {
    await resetDb();
    drafter.inputs.length = 0;
    drafter.mode = 'mock';
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function template(workflowName = 'KYC onboarding and refresh') {
    const domainId = (await db.domain.findFirst({ where: { clientId } }))?.id ?? (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (
      await post(admin, '/templates', {
        domainId,
        workflowName,
        primaryWork: 'Assemble identity evidence and recommend a disposition.',
        verificationCriteria: 'Document checks, completeness, policy adherence.',
        humanGate: 'Approval, rejection and high-risk classification remain human decisions.',
        defaultTptMinutes: 60,
        skills: ['KYC'],
        taskModes: ['AUTHORING'],
        coverageDimensions: { dimensions: [{ key: 'customer_type', label: 'Customer type', values: ['individual', 'corporate'] }, { key: 'risk_level', label: 'Risk level', values: ['low', 'high'] }], cells: [{ tags: { customer_type: 'corporate', risk_level: 'high' }, quota: 1, required: true }] },
        edgeCaseCatalog: [{ name: EDGE, quota: 1, required: true }],
      })
    ).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    return t.id as string;
  }

  async function expert(): Promise<Who> {
    const mail = `${randomUUID().slice(0, 8)}@example.test`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${mail}`, email: mail, name: 'Ada Author' }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED', contactEmail: mail } });
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: ['KYC'], skills: ['KYC'], jurisdictions: [], domainExperienceYears: 8, hoursPerWeek: 20, timezone: 'Europe/London', lastValidatedAt: new Date() } });
    return { cookie: `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`, smeUserId, candidateId: c.id };
  }

  /** A KYC authoring task on the "circular ownership" edge-case slot, its author, and a project reviewer. */
  async function kycTask(workflowName?: string) {
    const templateId = await template(workflowName);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { templateId, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB', 'IN'], required: false }] })).json();
    const sub = await post(pm, `/projects/${p.id}/submit`);
    expect(sub.statusCode, sub.body).toBe(200);
    expect((await post(pm, `/projects/${p.id}/match`)).statusCode).toBe(200);
    const r = await createUser(clientId, ['REVIEWER']);
    expect((await post(pm, `/projects/${p.id}/reviewers`, { userId: r.id })).statusCode).toBe(200);
    const a = await expert();
    expect((await post(pm, `/projects/${p.id}/assignments`, { candidateIds: [a.candidateId] })).statusCode).toBe(200);
    await deliver('candidate.assigned');
    const mine = await db.taskInstance.findMany({ where: { projectId: p.id, assignedToId: a.candidateId } });
    const t = mine.find((x) => (x.input as { slot: { edgeCase: string | null } }).slot.edgeCase === EDGE) ?? mine[0]!;
    return { a, id: t.id, others: mine.filter((x) => x.id !== t.id).map((x) => x.id), projectId: p.id as string, reviewer: await login(app, r.email) };
  }

  function upload(w: Who, id: string, buf: Buffer, filename: string, fields: Record<string, string> = { kind: 'DOCUMENT', declaration: 'true' }) {
    const boundary = `----praxis${randomUUID()}`;
    // Fields come before the file so the server sees them when it reads the stream.
    const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    const body = Buffer.concat([...parts, Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return app.inject({ method: 'POST', url: `/api/v1/me/tasks/${id}/sources`, headers: { cookie: w.cookie, ...idem(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
  }
  const drafting = async (w: Who, id: string) => (await get(w.cookie, `/me/tasks/${id}/drafting`)).json();
  const task = async (w: Who, id: string) => (await get(w.cookie, `/me/tasks/${id}`)).json();
  async function answerAll(w: Who, id: string) {
    const answers: Record<string, string> = {
      case: 'A trading company owned partly through a family trust; the settlor also sits on the board.',
      trigger: 'New onboarding',
      red_flags: `${EDGE}, Stale registry filing`,
      tools: 'Registry lookup, Document check, Sanctions / PEP screening, Risk calculator',
      ambiguous: 'A screening near match for a trustee, cleared on date of birth.',
      outcome: 'Escalate',
      risk: 'High',
      junior_mistake: 'Approving without identifying the settlor as a beneficial owner.',
    };
    let state = (await drafting(w, id)).interview;
    while (state.next) {
      const res = await post(w.cookie, `/me/tasks/${id}/interview/messages`, { clientMessageId: randomUUID(), questionId: state.next.id, content: answers[state.next.id] ?? 'n/a' });
      expect(res.statusCode, res.body).toBe(200);
      state = res.json();
    }
    return state;
  }
  async function draft(w: Who, id: string, body: object = {}) {
    const res = await post(w.cookie, `/me/tasks/${id}/drafts`, body);
    expect(res.statusCode, res.body).toBe(202);
    await deliver('task.draft.requested');
    return (await get(w.cookie, `/me/tasks/${id}/drafts/${res.json().id}`)).json();
  }
  const confirmAll = async (w: Who, id: string) => {
    for (const s of ['W01', 'W02', 'W03', 'W04', 'W05']) expect((await post(w.cookie, `/me/tasks/${id}/sections/${s}/confirm`)).statusCode).toBe(200);
  };
  async function submit(w: Who, id: string) {
    const t = await task(w, id);
    return post(w.cookie, `/me/tasks/${id}/submit`, { expectedRevision: t.revision, syntheticDeclaration: true });
  }


  describe('memory-backed conversational authoring', () => {
    it('queues once, remembers prior answers, confirms coordinated updates and rejects stale proposals', async () => {
      const { a, id } = await kycTask();
      const inputs: ConversationInput[] = [];
      const assistant: ConversationAssistant = { model: 'test-no-paid-calls', async propose(i) { inputs.push(i); return { reply: 'Identifiers are missing, not necessarily mandatory.', question: 'Which project rule requires an SSN or alternative?', changes: [{ section: 'scenario', value: { trigger: 'NEW_ONBOARDING', customerType: 'individual', businessContext: 'Name mismatch; Tax ID and SSN not supplied.' }, reason: 'Latest SME answer' }, { section: 'solution', value: { findings: [{ id: 'F1', description: 'Requirement unresolved', evidenceRefs: [], severity: 'MEDIUM' }] }, reason: 'Dependent finding' }], ruleLinks: [], unresolved: ['Which identifier rule applies?'] }; } };
      const rev = (await task(a, id)).revision;
      const payload = { content: 'Tax ID and SSN are absent; do not assume they are mandatory.', expectedRevision: rev };
      const key = idem();
      const first = await app.inject({ method: 'POST', url: `/api/v1/me/tasks/${id}/conversation/messages`, headers: { cookie: a.cookie, ...key }, payload });
      expect(first.statusCode, first.body).toBe(202);
      const replay = await app.inject({ method: 'POST', url: `/api/v1/me/tasks/${id}/conversation/messages`, headers: { cookie: a.cookie, ...key }, payload });
      expect(replay.json().runId).toBe(first.json().runId);
      await executeConversation(db, assistant, first.json().runId);
      await executeConversation(db, assistant, first.json().runId);
      expect(inputs).toHaveLength(1);
      expect(inputs[0]!.history[0]!.content).toContain('SSN');
      expect((await task(a, id)).output).toBeNull();
      const confirm = await post(a.cookie, `/me/tasks/${id}/conversation/decision`, { runId: first.json().runId, accept: true });
      expect(confirm.statusCode, confirm.body).toBe(200);
      const changed = await task(a, id);
      expect(changed.output.scenario.businessContext).toContain('SSN');
      expect(changed.output.solution.findings[0].id).toBe('F1');
      expect((await post(a.cookie, `/me/tasks/${id}/conversation/review`, { expectedRevision: changed.revision })).statusCode).toBe(409);
      const next = await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: 'The customer is an individual; keep the requirement unresolved.', expectedRevision: changed.revision });
      await executeConversation(db, assistant, next.json().runId);
      expect(inputs[1]!.current.scenario).toMatchObject({ businessContext: expect.stringContaining('SSN') });
      expect(inputs[1]!.history.length).toBeGreaterThan(2);
      expect(inputs[1]!.previousUnresolved).toContain('Which identifier rule applies?');
      await db.taskInstance.update({ where: { id }, data: { revision: { increment: 1 } } });
      expect((await post(a.cookie, `/me/tasks/${id}/conversation/decision`, { runId: next.json().runId, accept: true })).statusCode).toBe(409);
      expect((await get(a.cookie, `/me/tasks/${id}/agent-preview`)).body).not.toContain('Requirement unresolved');
    });
    it('enforces ownership, input privacy and read-only state before model dispatch', async () => {
      const { a, id } = await kycTask(); const stranger = await expert();
      expect((await get(stranger.cookie, `/me/tasks/${id}/conversation`)).statusCode).toBe(404);
      expect((await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: 'SSN 123-45-6789', expectedRevision: 0 })).statusCode).toBe(422);
      expect(await db.taskInterviewTurn.count({ where: { taskInstanceId: id, questionId: 'conversation' } })).toBe(0);
      await db.taskInstance.update({ where: { id }, data: { status: 'SUBMITTED' } });
      expect((await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: 'Change the scenario', expectedRevision: 0 })).statusCode).toBe(409);
    });
    it.each(['Q4 Global Paid Search Query Clustering', 'Omnichannel Creative and Locale Compliance', 'Adverse media review', 'Audit and evidence preparation', 'Communications surveillance', 'Compliance monitoring', 'Customer risk rating', 'Enhanced due diligence', 'Issue and remediation tracking', 'KYB and beneficial ownership', 'AML transaction-monitoring alerts'])('uses the same persistent engine for %s without pretending it is KYC', async workflow => {
      const { a, id } = await kycTask(workflow);
      let seen: ConversationInput | undefined;
      const run = await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: 'A fictional case with missing evidence. Which project rules apply?', expectedRevision: 0 });
      expect(run.statusCode, run.body).toBe(202);
      await executeConversation(db, { model: 'test-no-paid-calls', async propose(input) { seen = input; return { reply: 'Need applicable policy.', question: 'Which approved rule applies to this evidence?', changes: [], ruleLinks: [], unresolved: ['Applicability'] }; } }, run.json().runId);
      expect(seen?.workflow).toBe(workflow); expect(seen?.template).toBeTruthy();
      const v = (await get(a.cookie, `/me/tasks/${id}/conversation`)).json(); expect(v.messages.length).toBe(2); expect(v.state.pending.proposal.question).toContain('approved rule');
    });
    it('does not turn provider failure into a fake successful proposal', async () => {
      const { a, id } = await kycTask(); const r = await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: 'A fictional missing evidence case', expectedRevision: 0 });
      await executeConversation(db, { model: 'test-unavailable', async propose() { throw new Error('down'); } }, r.json().runId);
      const v = (await get(a.cookie, `/me/tasks/${id}/conversation`)).json();
      expect(v.run.status).toBe('FAILED'); expect(v.state.pending).toBeUndefined(); expect(v.output).toEqual({});
    });
  });
});
