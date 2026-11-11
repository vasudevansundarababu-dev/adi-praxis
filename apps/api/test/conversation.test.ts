import { sanitizeDraft, DRAFT_SECTIONS } from '../src/tasks/drafting/drafter';
import { executeConversation } from '../src/tasks/conversation/service';
import type { ConversationAssistant, ConversationInput } from '../src/tasks/conversation/assistant';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkWorkflowGraph, KYC_EXAMPLE_TASK, replayCall, type KycTask } from '@praxis/shared';
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
  let requestIp=1;
  const post = async (cookie: string, url: string, payload: object = {}) => {
    if (url.endsWith('/conversation/messages')) await app.inject({method:'POST',url:'/api/v1'+url.replace('/messages','/consent'),headers:{cookie,...idem()},payload:{version:'human-only/1',accepted:true}});
    const body = url.endsWith('/conversation/review') ? {...payload,ownWork:true,noExternalLlm:true,authorisedSources:true} : payload;
    return app.inject({method:'POST',url:`/api/v1${url}`,headers:{cookie,...idem()},payload:body,remoteAddress:'127.0.1.'+(requestIp++%250+1)});
  };
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
  async function kycTask(workflowName?: string, experience: 'CLASSIC'|'CHATBOT'|'BOTH' = 'BOTH') {
    const templateId = await template(workflowName);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { authoringExperience: experience, templateId, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB', 'IN'], required: false }] })).json();
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
      await post(a.cookie, `/me/tasks/${id}/conversation/consent`, {version:'human-only/1',accepted:true});
      const payload = { content: 'NEW_ONBOARDING individual. Name mismatch; Tax ID and SSN not supplied. Requirement unresolved. MEDIUM.', expectedRevision: rev };
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
      expect(inputs[1]!.previousUnresolved.length).toBeGreaterThan(0);
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
      const v = (await get(a.cookie, `/me/tasks/${id}/conversation`)).json(); expect(v.messages.length).toBe(2); expect(v.state.pending.proposal.question).toContain('published project rule');
    });

    it.each(['CLASSIC','CHATBOT','BOTH'] as const)('enforces %s project editors, common controls, preferences and unchanged task data',async mode=>{
      const {a,id,projectId}=await kycTask(undefined,mode);
      const initial=(await get(a.cookie,`/me/tasks/${id}`)).json();expect(initial.authoringExperience).toBe(mode);
      const unauth=await put(a.cookie,`/me/tasks/${id}`,{output:{header:{title:'Not saved'}},expectedRevision:0});expect(unauth.statusCode).toBe(mode==='CHATBOT'?403:409);
      expect((await post(a.cookie,`/me/tasks/${id}/conversation/consent`,{version:'human-only/1',accepted:true})).statusCode).toBe(200);
      const save=await put(a.cookie,`/me/tasks/${id}`,{output:{header:{title:'My own task'}},expectedRevision:0});expect(save.statusCode,save.body).toBe(mode==='CHATBOT'?403:200);
      const before=(await get(a.cookie,`/me/tasks/${id}`)).json();
      const message=await post(a.cookie,`/me/tasks/${id}/conversation/messages`,{content:'The name-change evidence is missing.',expectedRevision:before.revision});expect(message.statusCode,message.body).toBe(mode==='CLASSIC'?403:202);
      expect((await post(a.cookie,`/me/tasks/${id}/drafts`,{})).statusCode).not.toBe(202);
      const view=mode==='CLASSIC'?'CLASSIC':'CHATBOT';
      const pref=await post(a.cookie,`/me/tasks/${id}/authoring-workspace`,{view,answer:mode==='CLASSIC'?'':'Draft answer retained'});expect(pref.statusCode,pref.body).toBe(200);
      const resumed=(await get(a.cookie,`/me/tasks/${id}`)).json();expect(resumed.authoringWorkspace.view).toBe(view);expect(resumed.output).toEqual(before.output);expect(resumed.revision).toBe(before.revision);
      if(mode!=='BOTH')expect((await post(a.cookie,`/me/tasks/${id}/authoring-workspace`,{view:mode==='CLASSIC'?'CHATBOT':'CLASSIC',answer:''})).statusCode).toBe(403);
      expect((await app.inject({method:'PATCH',url:`/api/v1/projects/${projectId}`,headers:{cookie:pm,...idem()},payload:{authoringExperience:'CLASSIC'}})).statusCode).toBe(409);
      const stranger=await expert();expect((await post(stranger.cookie,`/me/tasks/${id}/authoring-workspace`,{view,answer:''})).statusCode).toBe(404);
      expect((await get(a.cookie,`/me/tasks/${id}/agent-preview`)).statusCode).toBe(200);
    });
    it('requires an explicit project authoring choice and preserves legacy NULL projects',async()=>{
      const {a,id,projectId}=await kycTask();
      const templateId=(await db.project.findUniqueOrThrow({where:{id:projectId}})).templateId;
      const missing=await app.inject({method:'POST',url:'/api/v1/projects',headers:{cookie:pm,...idem()},payload:{templateId,name:'No mode chosen'}});expect(missing.statusCode).toBe(400);expect(missing.json().error).toBe('AUTHORING_EXPERIENCE_REQUIRED');
      await db.project.update({where:{id:projectId},data:{authoringExperience:null}});
      expect((await get(a.cookie,`/me/tasks/${id}`)).json().effectiveAuthoringExperience).toBe('BOTH');
      expect((await put(a.cookie,`/me/tasks/${id}`,{output:{header:{title:'Legacy edit'}},expectedRevision:0})).statusCode).toBe(200);
    });

    it('Classic-only task completes common authorship, checks, human acceptance and dataset export without a model call',async()=>{
      const {a,id,projectId}=await kycTask(undefined,'CLASSIC');const v=await task(a,id);
      const input={slot:v.input.slot,template:{workflow:v.template.workflow,primaryWork:v.template.primaryWork,verificationCriteria:v.template.verificationCriteria,humanGate:v.template.humanGate,coverageDimensions:v.template.coverageDimensions},current:{},sections:[...DRAFT_SECTIONS],sources:[],interview:[],instruction:null,forbidden:[]};
      // Prepared synthetic fixture stands in for SME-entered fields; no drafting/model run is invoked.
      const output=sanitizeDraft((await new MockTaskDrafter().draft(input)).task,input).task;
      expect((await post(a.cookie,`/me/tasks/${id}/conversation/consent`,{version:'human-only/1',accepted:true})).statusCode).toBe(200);
      const saved=await put(a.cookie,`/me/tasks/${id}`,{output,expectedRevision:v.revision,activeSecondsDelta:0});expect(saved.statusCode,saved.body).toBe(200);
      const checks=(await post(a.cookie,`/me/tasks/${id}/check`)).json();expect(checks.checks.find((c:{id:string})=>c.id==='conversation.authorship').ok).toBe(false);
      expect((await post(a.cookie,`/me/tasks/${id}/conversation/review`,{expectedRevision:saved.json().revision})).statusCode).toBe(200);
      const submitted=await submit(a,id);expect(submitted.statusCode,submitted.body).toBe(200);
      const review=(await get(admin,`/review/tasks/${id}`)).json();
      const accepted=await post(admin,`/review/tasks/${id}/decision`,{expectedRevision:review.revision,decision:'ACCEPT',checklist:{correct:true,realistic:true,coversSlot:true,difficultyFair:true,distinct:true,rubricCatches:true}});expect(accepted.statusCode,accepted.body).toBe(200);
      expect((await get(admin,`/dataset/export?projectId=${projectId}`)).body).toContain(id);
      expect(await db.taskDraftRun.count({where:{taskInstanceId:id}})).toBe(0);
      expect(await db.approvedTaskRecord.count({where:{taskInstanceId:id}})).toBe(1);
    });
    it('authoring v2.1: workflow graph is checked, projected for the agent, reviewed and exported beside the record', async () => {
      const { a, id, projectId } = await kycTask(undefined, 'CLASSIC'); const v = await task(a, id);
      // Task view: template-fixed agent mode, three-state phase, review route and the template's starting workflow.
      expect(v.agentMode).toBe('SINGLE'); expect(v.reviewRoute).toBe('SME_PM'); expect(v.phase).toMatchObject({ phase: 'AUTHORING', stage: null });
      expect(v.startingGraph?.schemaVersion).toBe('praxis.workflow_graph.v1-proposed');
      const input = { slot: v.input.slot, template: { workflow: v.template.workflow, primaryWork: v.template.primaryWork, verificationCriteria: v.template.verificationCriteria, humanGate: v.template.humanGate, coverageDimensions: v.template.coverageDimensions }, current: {}, sections: [...DRAFT_SECTIONS], sources: [], interview: [], instruction: null, forbidden: [] };
      const base = sanitizeDraft((await new MockTaskDrafter().draft(input)).task, input).task;
      expect((await post(a.cookie, `/me/tasks/${id}/conversation/consent`, { version: 'human-only/1', accepted: true })).statusCode).toBe(200);
      // A decision with no else route blocks submission with a precise reason.
      const broken = structuredClone(v.startingGraph); broken.edges = broken.edges.filter((e: { port?: string }) => e.port !== 'else');
      let saved = await put(a.cookie, `/me/tasks/${id}`, { output: { ...base, workflowGraph: broken }, expectedRevision: v.revision, activeSecondsDelta: 0 }); expect(saved.statusCode, saved.body).toBe(200);
      let checks = (await post(a.cookie, `/me/tasks/${id}/check`)).json().checks as { id: string; ok: boolean; message: string; section: string }[];
      const missingElse = checks.find((c) => c.id.startsWith('graph.decision_missing_else'));
      expect(missingElse).toMatchObject({ ok: false, section: 'GRAPH' }); expect(missingElse!.message).toContain('else');
      // The graph's agent mode must match the template's.
      saved = await put(a.cookie, `/me/tasks/${id}`, { output: { ...base, workflowGraph: { ...v.startingGraph, agentMode: 'MULTI' } }, expectedRevision: saved.json().revision, activeSecondsDelta: 0 });
      checks = (await post(a.cookie, `/me/tasks/${id}/check`)).json().checks; expect(checks.find((c) => c.id === 'graph.agent_mode')?.ok).toBe(false);
      // A valid graph with a private reference artifact: the agent view never shows it.
      const graph = structuredClone(v.startingGraph); graph.artifacts.push({ id: 'reference_answer', label: 'Reference disposition', visibility: 'private_reference' });
      saved = await put(a.cookie, `/me/tasks/${id}`, { output: { ...base, workflowGraph: graph }, expectedRevision: saved.json().revision, activeSecondsDelta: 0 });
      checks = (await post(a.cookie, `/me/tasks/${id}/check`)).json().checks; expect(checks.find((c) => c.id === 'graph.valid')?.ok).toBe(true);
      const preview = (await get(a.cookie, `/me/tasks/${id}/agent-preview`)).json();
      expect(preview.task.workflowGraph.nodes.length).toBe(graph.nodes.length); expect(JSON.stringify(preview)).not.toContain('reference_answer'); expect(JSON.stringify(preview)).not.toContain('findings.sufficient');
      expect((await post(a.cookie, `/me/tasks/${id}/conversation/review`, { expectedRevision: saved.json().revision })).statusCode).toBe(200);
      const submitted = await submit(a, id); expect(submitted.statusCode, submitted.body).toBe(200);
      expect((await task(a, id)).phase).toMatchObject({ phase: 'PENDING', stage: 'PM_APPROVAL' });
      const review = (await get(admin, `/review/tasks/${id}`)).json();
      const accepted = await post(admin, `/review/tasks/${id}/decision`, { expectedRevision: review.revision, decision: 'ACCEPT', checklist: { correct: true, realistic: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true } }); expect(accepted.statusCode, accepted.body).toBe(200);
      expect((await task(a, id)).phase).toMatchObject({ phase: 'APPROVED' });
      const record = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: id } });
      const exported = await get(admin, `/dataset/records/${record.id}/workflow-graph`); expect(exported.statusCode, exported.body).toBe(200);
      expect(exported.headers['x-praxis-schema-version']).toBe('praxis.workflow_graph.v1-proposed');
      expect(exported.headers['x-praxis-graph-content-hash']).toMatch(/^[a-f0-9]{64}$/); expect(String(exported.headers['x-praxis-graph-execution'])).toContain('not-executable');
      expect(exported.json().nodes.length).toBe(graph.nodes.length);
      expect((await get(pm, `/dataset/records/${record.id}/workflow-graph`)).statusCode).toBe(403);
      // Review route: the default is SME -> PM; Wave 2 enables SME -> Expert -> PM (its stage engine is tested in review-stages.test.ts).
      const project = (await get(pm, `/projects/${projectId}`)).json(); expect(project.reviewRoute).toBe('SME_PM'); expect(project.agentMode).toBe('SINGLE');
      const templateId = project.templateId;
      const expertRoute = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: { cookie: pm, ...idem() }, payload: { templateId, name: 'Expert route', authoringExperience: 'BOTH', reviewRoute: 'SME_EXPERT_PM' } });
      expect(expertRoute.statusCode, expertRoute.body).toBe(201); expect(expertRoute.json().reviewRoute).toBe('SME_EXPERT_PM');
    });
    it('authoring v2.1: Admins see which model providers are live; the chatbot stops at the daily call cap', async () => {
      const status = await get(admin, '/admin/model-providers'); expect(status.statusCode, status.body).toBe(200);
      expect(status.json()).toMatchObject({ mode: 'mock', models: { authoringChatbot: 'mock-conversation-no-model' }, authoringChatbot: { dailyCallCap: 300 } });
      expect(JSON.stringify(status.json())).not.toMatch(/key|secret|token/i);
      expect((await get(pm, '/admin/model-providers')).statusCode).toBe(403);
      const { a, id } = await kycTask(); const v = await task(a, id);
      await post(a.cookie, `/me/tasks/${id}/conversation/consent`, { version: 'human-only/1', accepted: true });
      const used = (await get(admin, '/admin/model-providers')).json().authoringChatbot.callsToday as number;
      const filler = Array.from({ length: 300 - used }, () => ({ clientId, taskInstanceId: id, section: 'CHAT', status: 'SUCCEEDED' as const, requestedById: a.smeUserId, promptVersion: 'cap-test' }));
      await db.taskDraftRun.createMany({ data: filler });
      try {
        const capped = await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: 'The applicant supplied no address record.', expectedRevision: (await task(a, id)).revision });
        expect(capped.statusCode).toBe(429); expect(capped.json().error).toBe('MODEL_DAILY_CAP');
        expect(await db.taskInterviewTurn.count({ where: { taskInstanceId: id, content: 'The applicant supplied no address record.' } })).toBe(0);
      } finally {
        await db.taskDraftRun.deleteMany({ where: { promptVersion: 'cap-test' } });
      }
      void v;
    });
    it('authoring v2.1 Wave 2: the chatbot proposes workflow changes in the SME\'s words; they apply only on confirmation', async () => {
      const { a, id } = await kycTask(); const v = await task(a, id);
      expect((await post(a.cookie, `/me/tasks/${id}/conversation/consent`, { version: 'human-only/1', accepted: true })).statusCode).toBe(200);
      const saved = await put(a.cookie, `/me/tasks/${id}`, { output: { header: { title: 'Graph chat case' }, workflowGraph: v.startingGraph }, expectedRevision: v.revision, activeSecondsDelta: 0 }); expect(saved.statusCode, saved.body).toBe(200);
      const words = 'After the recommendation, add a step called Screen sanctions lists: Check every party against the sanctions lists before the approver decides.';
      const own = { op: 'add_step_after', nodeId: 'conclude', label: 'Screen sanctions lists', instruction: 'Check every party against the sanctions lists before the approver decides.' };
      const scripted = (graphOps: unknown[]): ConversationAssistant => ({ model: 'graph-test-mock', async propose() { return { reply: 'ok', question: 'Anything else?', changes: [], ruleLinks: [], unresolved: [], graphOps } as never; } });
      // 1. The SME's own words: the proposal is pending with no problems, nothing changes until confirmed.
      const m1 = await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: words, expectedRevision: (await task(a, id)).revision }); expect(m1.statusCode, m1.body).toBe(202);
      await executeConversation(db, scripted([own]), m1.json().runId);
      let conv = (await get(a.cookie, `/me/tasks/${id}/conversation`)).json();
      expect(conv.state.pending.proposal.graphOps).toEqual([own]); expect(conv.state.pending.problems).toEqual([]);
      expect(((await task(a, id)).output.workflowGraph.nodes as { label: string }[]).some((n) => n.label === 'Screen sanctions lists')).toBe(false);
      expect((await post(a.cookie, `/me/tasks/${id}/conversation/decision`, { runId: m1.json().runId, accept: true })).statusCode).toBe(200);
      const after = (await task(a, id)).output.workflowGraph;
      expect(after.nodes.some((n: { label: string }) => n.label === 'Screen sanctions lists')).toBe(true);
      expect(checkWorkflowGraph(after).errors).toEqual([]);
      // 2. Wording the SME never wrote, or a change that cannot apply: blocked with a precise reason.
      const m2 = await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: 'Please add a person step.', expectedRevision: (await task(a, id)).revision });
      await executeConversation(db, scripted([{ op: 'add_human_step_after', nodeId: 'ghost', label: 'Compliance officer approves', actorRole: 'Compliance officer', prompt: 'Approve the file.' }]), m2.json().runId);
      conv = (await get(a.cookie, `/me/tasks/${id}/conversation`)).json();
      expect(conv.state.pending.problems.join(' ')).toMatch(/Type your own wording for workflow change 1/);
      expect(conv.state.pending.problems.join(' ')).toMatch(/cannot apply: There is no step ghost/);
      const blocked = await post(a.cookie, `/me/tasks/${id}/conversation/decision`, { runId: m2.json().runId, accept: true });
      expect(blocked.statusCode).toBe(422); expect(blocked.json().error).toBe('PROPOSAL_BLOCKED');
    });
    it('integrates chat with existing submit, Admin rework, resubmit, acceptance, hash chain and dataset export', async () => {
      const { a, id, projectId } = await kycTask();
      const view = await task(a, id);
      const input = { slot: view.input.slot, template: { workflow: view.template.workflow, primaryWork: view.template.primaryWork, verificationCriteria: view.template.verificationCriteria, humanGate: view.template.humanGate, coverageDimensions: view.template.coverageDimensions }, current: {}, sections: [...DRAFT_SECTIONS], sources: [], interview: [], instruction: null, forbidden: [] };
      const draft = sanitizeDraft((await new MockTaskDrafter().draft(input)).task, input).task;
      await post(a.cookie, `/me/tasks/${id}/conversation/consent`, {version:'human-only/1',accepted:true});
      await put(a.cookie, `/me/tasks/${id}`, {output:draft,expectedRevision:view.revision,activeSecondsDelta:0});
      const authored = await task(a,id);
      const provider: ConversationAssistant = { model: 'lifecycle-test-mock', async propose(context) { return { reply: 'Review this complete synthetic case.', question: 'Have you reviewed the linked evidence and recommendation?', changes: [], ruleLinks: [], unresolved: [] }; } };
      const first = await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: 'I authored this synthetic case in the detailed editor; the pending filing must be explicit.', expectedRevision: authored.revision });
      await executeConversation(db, provider, first.json().runId);
      const c = await post(a.cookie, `/me/tasks/${id}/conversation/decision`, { runId: first.json().runId, accept: true }); expect(c.statusCode,c.body).toBe(200);
      const reviewed = await task(a,id);
      expect((await post(a.cookie, `/me/tasks/${id}/conversation/review`, { expectedRevision: reviewed.revision })).statusCode).toBe(200);
      const submitted = await submit(a,id); expect(submitted.statusCode,submitted.body).toBe(200);
      const checklist = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };
      const r = (await get(admin, `/review/tasks/${id}`)).json();
      const rework = await post(admin, `/review/tasks/${id}/decision`, { expectedRevision: r.revision, decision: 'REWORK', checklist, comments: [{ section: 'W04', text: 'Explain the pending evidence request more clearly.' }] }); expect(rework.statusCode,rework.body).toBe(200);
      const before = await task(a,id);
      const second = await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: 'The requested updated filing remains pending.', expectedRevision: before.revision });
      let feedback: unknown;
      await executeConversation(db, { model: 'lifecycle-test-mock', async propose(context) { feedback = context.reviewFeedback; return { reply: 'The reviewer feedback is included.', question: 'Please confirm the clarified rationale.', changes: [{ section: 'solution', value: { ...draft.solution, rationale: draft.solution!.rationale + ' The requested updated filing remains pending.' }, reason: 'Admin rework comment' }], ruleLinks: [], unresolved: [] }; } }, second.json().runId);
      expect(JSON.stringify(feedback)).toContain('pending evidence request');
      expect((await post(a.cookie, `/me/tasks/${id}/conversation/decision`, { runId: second.json().runId, accept: true })).statusCode).toBe(200);
      const ready=await task(a,id); expect((await post(a.cookie, `/me/tasks/${id}/conversation/review`, { expectedRevision: ready.revision })).statusCode).toBe(200);
      const resubmitted=await submit(a,id); expect(resubmitted.statusCode,resubmitted.body).toBe(200);
      const final=(await get(admin, `/review/tasks/${id}`)).json();
      const accept=await post(admin, `/review/tasks/${id}/decision`, { expectedRevision: final.revision, decision:'ACCEPT', checklist }); expect(accept.statusCode,accept.body).toBe(200);
      expect(await db.approvedTaskRecord.count({where:{taskInstanceId:id}})).toBe(1);
      expect((await verifyApprovedChain(db)).breaks).toEqual([]);
      const exported=await get(admin, `/dataset/export?projectId=${projectId}`); expect(exported.statusCode).toBe(200); expect(exported.body).toContain(id);
      const record=await db.approvedTaskRecord.findFirstOrThrow({where:{taskInstanceId:id}});
      expect((await get(admin, `/dataset/records/${record.id}/replay`)).statusCode).toBe(200);
      const executable=await get(admin, `/dataset/records/${record.id}/praxis-contract`); expect(executable.statusCode).toBe(409); expect(executable.json().error).toBe('NO_EXECUTABLE_CONTRACT');
    });
    it('does not turn provider failure into a fake successful proposal', async () => {
      const { a, id } = await kycTask(); const r = await post(a.cookie, `/me/tasks/${id}/conversation/messages`, { content: 'A fictional missing evidence case', expectedRevision: 0 });
      await executeConversation(db, { model: 'test-unavailable', async propose() { throw new Error('down'); } }, r.json().runId);
      const v = (await get(a.cookie, `/me/tasks/${id}/conversation`)).json();
      expect(v.run.status).toBe('FAILED'); expect(v.state.pending).toBeUndefined(); expect(v.output).toEqual({});
    });
  });
});
