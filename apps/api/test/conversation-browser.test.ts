import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
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
  async function kycTask(workflowName?: string) {
    const templateId = await template(workflowName);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { authoringExperience: 'BOTH', templateId, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB', 'IN'], required: false }] })).json();
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



  it('actual browser: answer -> proposal -> confirm -> map/rubric -> resume -> agent preview', async () => {
    const { a, id } = await kycTask();
    await db.taskInstance.update({ where: { id }, data: { output: KYC_EXAMPLE_TASK as never } });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const child = spawn('pnpm', ['--filter', '@praxis/candidate', 'exec', 'next', 'dev', '-H', '127.0.0.1', '-p', '0'], { cwd: new URL('../../../', import.meta.url), env: { ...process.env, NODE_ENV: 'development', API_BASE_URL: address, NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: '.next-verify' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let logs = '';
    const port = await new Promise<number>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Next startup timeout: '+logs.slice(-1000))), 60000); const data = (chunk: Buffer) => { logs += chunk.toString(); const match = logs.match(/http:\/\/127\.0\.0\.1:(\d+)/); if(match) { clearTimeout(timer); resolve(Number(match[1])); } }; child.stdout.on('data', data); child.stderr.on('data', data); child.on('error', reject); }).catch(error => { if (child.pid) process.kill(-child.pid, 'SIGTERM'); throw error; });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let webChild: ReturnType<typeof spawn> | null = null;
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await page.context().addCookies([{ name: 'praxis_candidate', value: a.cookie.split('=')[1]!, domain: '127.0.0.1', path: '/' }]);
      await page.goto(`http://127.0.0.1:${port}/tasks/${id}`, { waitUntil: 'networkidle' });
      await page.getByLabel('I agree to these terms.').check();
      await page.getByRole('button',{name:'Accept authorship terms'}).click();
      await page.getByRole('heading', { name: 'Build a case through conversation' }).waitFor();
      await page.getByLabel('Your answer').fill('My unsent answer survives the view switch.');
      await page.getByRole('button',{name:'Classic',exact:true}).click();
      await page.getByRole('textbox',{name:/^Title/}).fill('An SME typed this title in Classic');
      await page.getByRole('button',{name:'Chatbot',exact:true}).click();
      expect(await page.getByLabel('Your answer').inputValue()).toBe('My unsent answer survives the view switch.');
      expect((await task(a,id)).output.header.title).toBe('An SME typed this title in Classic');
      const pasteBlocked=await page.getByLabel('Your answer').evaluate(el=>{const event=new Event('paste',{bubbles:true,cancelable:true});el.dispatchEvent(event);return event.defaultPrevented;});
      expect(pasteBlocked).toBe(true);
      await page.getByLabel('Your answer').fill('SSN and Tax ID absent; policy applicability unresolved. Identifier gaps recorded; ask for applicable approved policy. Check identifiers without inventing a requirement.');
      await page.getByRole('button', { name: 'Send answer' }).click();
      let run;
      for (let i=0;i<30;i++) { run = await db.taskDraftRun.findFirst({ where: { taskInstanceId: id, section: 'CHAT' } }); if (run) break; await new Promise(r=>setTimeout(r,100)); }
      expect(run).toBeTruthy();
      const after = structuredClone(KYC_EXAMPLE_TASK);
      after.scenario!.businessContext += ' SSN and Tax ID absent; policy applicability unresolved.';
      after.rubric!.criteria![0]!.name = 'Check identifiers without inventing a requirement';
      after.solution!.steps![0]!.expectedResult = 'Identifier gaps recorded; ask for applicable approved policy.';
      await executeConversation(db, { model: 'browser-test-no-model', async propose(input) { expect(input.history.at(-1)?.content).toContain('SSN'); return { reply: 'I correlated the identifier gap with the case, map and grading.', question: 'Which approved project rule requires an identifier?', changes: [{ section: 'scenario', value: after.scenario, reason: 'SME observation' }, { section: 'solution', value: after.solution, reason: 'Related investigation' }, { section: 'rubric', value: after.rubric, reason: 'Related grading criterion' }], ruleLinks: [], unresolved: ['Identifier applicability'] }; } }, run!.id);
      await page.getByRole('button', { name: 'Confirm changes', exact: true }).waitFor({ timeout: 20000 });
      await page.getByRole('button', { name: 'Confirm changes', exact: true }).click();
      await page.getByRole('button', { name: /Identifier gaps recorded/ }).waitFor();
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByText('I can organise your typed answer.',{exact:false}).first().waitFor();
      await page.getByText('Reference outcome and rubric', { exact: true }).click();
      await page.locator('pre').filter({hasText:'Check identifiers without inventing'}).waitFor();
      await page.screenshot({ path: '/private/tmp/praxis-conversation-real-browser.png', fullPage: true });
      await page.getByRole('button', { name: 'View as agent' }).click();
      await page.getByRole('button', { name: 'Return to authoring' }).waitFor();
      const preview = await page.locator('pre').textContent();
      expect(preview).not.toContain('Check identifiers without inventing'); expect(preview).not.toContain('solution');
      expect(preview).toContain('SSN and Tax ID absent');
      await page.getByRole('button', { name: 'Return to authoring' }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByText('Phone view is read-only.', { exact: false }).waitFor();
      expect(await page.getByLabel('Your answer').isDisabled()).toBe(true);
      await page.getByRole('button',{name:'Classic',exact:true}).click();
      expect(await page.getByRole('textbox', { name: /^Title/ }).isDisabled()).toBe(true);
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.getByRole('textbox', { name: /^Title/ }).waitFor();
      for (let i=0;i<20 && await page.getByRole('textbox', { name: /^Title/ }).isDisabled();i++) await new Promise(r=>setTimeout(r,50));
      expect(await page.getByRole('textbox', { name: /^Title/ }).isEnabled()).toBe(true);
      // Actual PM UI: the required choice is persisted and restored for every mode.
      webChild=spawn('pnpm',['--filter','@praxis/web','exec','next','dev','-H','127.0.0.1','-p','0'],{cwd:new URL('../../../',import.meta.url),env:{...process.env,NODE_ENV:'development',API_BASE_URL:address,NEXT_TELEMETRY_DISABLED:'1',NEXT_DIST_DIR:'.next-verify'},stdio:['ignore','pipe','pipe'],detached:true});
      let webLogs='';
      const webPort=await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Console startup timeout '+webLogs.slice(-500))),60000);const collect=(chunk:Buffer)=>{webLogs+=chunk.toString();const m=webLogs.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}};webChild!.stdout!.on('data',collect);webChild!.stderr!.on('data',collect);});
      const manager=await browser.newPage({viewport:{width:1200,height:900}});
      await manager.context().addCookies([{name:'praxis_session',value:pm.split('=')[1]!,domain:'127.0.0.1',path:'/'}]);
      for(const mode of ['CLASSIC','CHATBOT','BOTH'] as const){
        const name='UI '+mode+' '+randomUUID().slice(0,6);
        const label=new RegExp('^'+(mode==='CLASSIC'?'Classic':mode==='CHATBOT'?'Chatbot':'Both'));
        await manager.goto(`http://127.0.0.1:${webPort}/projects/new`,{waitUntil:'networkidle'});
        await manager.getByRole('button',{name:'2. Basics',exact:true}).click();
        await manager.getByLabel('Project name',{exact:false}).fill(name);
        await manager.getByRole('button',{name:'Save as draft',exact:true}).click();
        await manager.getByRole('alert').filter({hasText:'Choose Classic, Chatbot or Both'}).waitFor();
        await manager.getByRole('radio',{name:label}).check();
        await manager.getByRole('button',{name:'Save as draft',exact:true}).click();
        await manager.getByRole('status').filter({hasText:'Draft saved.'}).waitFor();
        expect((await db.project.findFirstOrThrow({where:{name}})).authoringExperience).toBe(mode);
        await manager.reload({waitUntil:'networkidle'});
        expect(await manager.getByRole('radio',{name:label}).isChecked()).toBe(true);
      }
      await manager.screenshot({path:'/private/tmp/praxis-mode-project-creation.png',fullPage:true});

    } finally { await browser.close(); if(webChild?.pid){try{process.kill(-webChild.pid,'SIGTERM');}catch{}} if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } }
  }, 150000);
});
