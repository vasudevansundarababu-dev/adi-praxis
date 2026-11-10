import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CandidateRule } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { processExtractionJob, type Adapters } from '../src/policy/extraction/service';
import { ProviderError, type ExtractionAdapter, type ProviderResult } from '../src/policy/extraction/types';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';
import { pdfWithText } from './documents';

/**
 * Policy Rules API (docs/prd/PRD-POLICY-RULES.md section 10). Providers are deterministic test doubles: tests never
 * make live provider calls (owner D-D1). The double behaves like a provider: it accepts a job, reports status and
 * returns candidate rules whose quotes come from the uploaded document.
 */
class FakeProvider implements ExtractionAdapter {
  calls = { submit: 0, status: 0, result: 0, cleanup: 0 };
  problems: string[] = [];
  mode: 'ok' | 'fail' | 'ambiguous' | 'bad-quote' = 'ok';
  constructor(readonly provider: 'llamaextract' | 'google') {}
  availability() {
    return this.problems;
  }
  async submit() {
    this.calls.submit++;
    if (this.mode === 'ambiguous') throw new ProviderError('LlamaExtract request failed: TimeoutError', true, undefined, true);
    return { operationId: `op-${this.calls.submit}` };
  }
  async getStatus() {
    this.calls.status++;
    return this.mode === 'fail' ? { status: 'failed' as const, error: 'Provider rejected the file.' } : { status: 'succeeded' as const };
  }
  async getResult(_op: string, input: { text: string }): Promise<ProviderResult> {
    this.calls.result++;
    const quote = this.mode === 'bad-quote' ? 'This sentence is not in the document at all.' : 'Agents must obtain written manager approval before scheduling a launch event.';
    const c: CandidateRule = {
      ruleKey: 'APPROVAL',
      title: 'Manager approval before scheduling',
      requirement: 'Obtain written manager approval before scheduling a launch event.',
      requirementType: 'obligation',
      visibility: 'agent_visible',
      applicability: { universal: false, actors: ['agent'], actions: ['schedule launch event'], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null },
      prerequisites: [],
      precedence: [],
      exceptions: { kind: 'none', items: [] },
      effective: { from: '2026-01-01', to: null, conditionText: null },
      evidenceNeeds: ['approval record'],
      verificationHint: null,
      uncertainty: [],
      citations: [{ fieldPath: 'requirement', role: 'supports', quote, page: 1, chunkId: null, lineStart: null, lineEnd: null, confidence: 0.9 }],
    };
    expect(input.text).toContain('manager approval');
    return { raw: { ok: true }, candidates: [c], partial: false, usage: { pages: 1, credits: 40, inputTokens: null, outputTokens: null, actualUsd: 0.06 } };
  }
  async cleanup() {
    this.calls.cleanup++;
    return 'deleted' as const;
  }
}

const POLICY_TEXT = 'Launch policy.\nAgents must obtain written manager approval before scheduling a launch event.\nRefunds are out of scope.';

let app: FastifyInstance;
let storage: MemoryStorage;
let llama: FakeProvider;
let google: FakeProvider;
let clientId: string;
let pmCookie: string;
let adminCookie: string;
let otherPmCookie: string;
let projectId: string;
let taskId: string;

const adapters = (): Adapters => ({ llamaextract: llama, google });
const worker = (jobId: string) => processExtractionJob({ db, storage, adapters: adapters(), sleep: async () => undefined }, jobId);

async function fixture() {
  const c = await createClient();
  clientId = c.id;
  const pm = await createUser(clientId, ['PM']);
  const admin = await createUser(clientId, ['ADMIN']);
  const other = await createUser(clientId, ['PM']);
  const domain = await db.domain.create({ data: { clientId, name: 'Launch' } });
  const template = await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: 'Launch of Noise Cancelling Phone' } });
  const project = await db.project.create({ data: { clientId, ownerId: pm.id, templateId: template.id, templateVersion: 1, name: 'Phone launch' } });
  const task = await db.taskInstance.create({ data: { clientId, projectId: project.id, taskType: 'AUTHORING' } });
  projectId = project.id;
  taskId = task.id;
  pmCookie = await login(app, pm.email);
  adminCookie = await login(app, admin.email);
  otherPmCookie = await login(app, other.email);
}

const api = (cookie: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } }),
  post: (url: string, payload: unknown, key = randomUUID()) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, 'idempotency-key': key }, payload: payload as object }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
  patch: (url: string, payload: unknown) => app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
});

function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = `----praxis${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(cookie: string, file: { name: string; type: string; data: Buffer }, fields: Record<string, string> = { title: 'Launch policy' }) {
  const m = multipart(fields, file);
  return app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/policy/documents`, headers: { cookie, 'content-type': m.contentType, ...idem() }, payload: m.body });
}

async function enableDefaultProfile() {
  await api(adminCookie).get(`/projects/${projectId}/policy/extraction`);
  const r = await api(adminCookie).patch('/policy/extraction-profiles/llama-agentic-v1', { enabled: true });
  expect(r.statusCode).toBe(200);
}

async function uploadedVersion() {
  const r = await upload(pmCookie, { name: 'launch.txt', type: 'text/plain', data: Buffer.from(POLICY_TEXT) });
  expect(r.statusCode).toBe(201);
  return r.json().version.id as string;
}

async function extractedRule() {
  await enableDefaultProfile();
  const versionId = await uploadedVersion();
  const r = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [versionId] });
  expect(r.statusCode).toBe(202);
  await worker(r.json().jobs[0].id);
  const rules = (await api(pmCookie).get(`/projects/${projectId}/policy/rules`)).json().items;
  return { versionId, rule: rules[0], batchId: r.json().batchId as string };
}

beforeAll(async () => {
  storage = new MemoryStorage();
  app = await buildApp({ config: testConfig({ POLICY_BUDGET_LLAMA_USD: '20', POLICY_BUDGET_GOOGLE_USD: '30' }), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage, policyAdapters: { get llamaextract() { return llama; }, get google() { return google; } } as Adapters });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  storage.objects.clear();
  llama = new FakeProvider('llamaextract');
  google = new FakeProvider('google');
  await fixture();
});

describe('documents (AC01–AC04, A08)', () => {
  it('stores an immutable version with hash, page count and private text; a new upload is a new version', async () => {
    const first = await upload(pmCookie, { name: 'launch.pdf', type: 'application/pdf', data: pdfWithText(POLICY_TEXT) });
    expect(first.statusCode).toBe(201);
    const v1 = first.json().version;
    expect(v1).toMatchObject({ version: 1, format: 'pdf', pageCount: 1, pageCountMethod: 'pdf_pages', locatorGranularity: 'page' });
    expect(v1.sha256).toMatch(/^[0-9a-f]{64}$/);

    const second = await upload(pmCookie, { name: 'launch-v2.txt', type: 'text/plain', data: Buffer.from(`${POLICY_TEXT}\nUpdated.`) }, { title: 'Launch policy', documentId: first.json().documentId });
    expect(second.json().version.version).toBe(2);
    const same = await upload(pmCookie, { name: 'again.txt', type: 'text/plain', data: Buffer.from(`${POLICY_TEXT}\nUpdated.`) }, { title: 'Launch policy', documentId: first.json().documentId });
    expect(same.statusCode).toBe(200);
    expect(same.json().created).toBe(false);

    const list = (await api(pmCookie).get(`/projects/${projectId}/policy/documents`)).json();
    expect(list.items[0].versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(await db.auditEvent.count({ where: { clientId, action: 'policy.document_version_added' } })).toBe(2);
    await expect(db.$executeRawUnsafe(`UPDATE "PolicyDocumentVersion" SET sha256 = 'x' WHERE id = '${v1.id}'`)).rejects.toThrow();
  });

  it('rejects unsupported files and documents over the page limit with a clear message', async () => {
    const zip = await upload(pmCookie, { name: 'data.xlsx', type: 'application/zip', data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]) });
    expect(zip.statusCode).toBe(415);
    const big = await upload(pmCookie, { name: 'big.txt', type: 'text/plain', data: Buffer.from('x'.repeat(2400 * 21)) });
    expect(big.statusCode).toBe(422);
    expect(big.json().error).toBe('TOO_MANY_PAGES');
    expect(big.json().message).toContain('limit is 20 pages');
  });

  it('accepts pasted text with a declared locator granularity and never invents page numbers', async () => {
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Pasted policy', text: POLICY_TEXT, granularity: 'section' });
    expect(r.statusCode).toBe(201);
    expect(r.json().version).toMatchObject({ origin: 'MANUAL_TEXT', locatorGranularity: 'section', format: 'txt' });
  });

  it('keeps projects private: another PM gets 404 and SMEs have no route', async () => {
    const r = await upload(otherPmCookie, { name: 'a.txt', type: 'text/plain', data: Buffer.from(POLICY_TEXT) });
    expect(r.statusCode).toBe(404);
    expect((await api(otherPmCookie).get(`/projects/${projectId}/policy/rules`)).statusCode).toBe(404);
  });
});

describe('extraction (AC04–AC05, AC17, A01–A03, A07, A12)', () => {
  it('reports Not available while the profile is disabled and never fakes a receipt', async () => {
    const versionId = await uploadedVersion();
    const status = (await api(pmCookie).get(`/projects/${projectId}/policy/extraction`)).json();
    expect(status.available).toBe(false);
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [versionId] });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('PROFILE_DISABLED');
    expect(await db.extractionBatch.count()).toBe(0);
    expect(llama.calls.submit).toBe(0);
  });

  it('reports Not available when the provider is not configured, with no fallback to the other provider', async () => {
    await enableDefaultProfile();
    llama.problems = ['The LlamaExtract API key is not configured.'];
    const versionId = await uploadedVersion();
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [versionId] });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toContain('Not available');
    expect(google.calls.submit + llama.calls.submit).toBe(0);
  });

  it('runs one job per version, stores candidates as drafts with a verified citation, and is idempotent', async () => {
    await enableDefaultProfile();
    const versionId = await uploadedVersion();
    const body = { documentVersionIds: [versionId] };
    const a = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, body);
    const b = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, body);
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(200);
    expect(b.json().batchId).toBe(a.json().batchId);
    const jobId = a.json().jobs[0].id;
    await worker(jobId);
    await worker(jobId);
    expect(llama.calls.submit).toBe(1);

    const job = await db.extractionJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: 'SUCCEEDED', candidateCount: 1, providerOperationId: 'op-1', cleanup: 'deleted' });
    const batch = await db.extractionBatch.findUniqueOrThrow({ where: { id: a.json().batchId } });
    expect(batch).toMatchObject({ status: 'SUCCEEDED', profileId: 'llama-agentic-v1', selectionSource: 'deployment' });

    const rules = (await api(pmCookie).get(`/projects/${projectId}/policy/rules`)).json().items;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ ruleKey: 'R-APPROVAL', state: 'DRAFT' });
    expect(rules[0].sources[0].resolution).toBe('RESOLVED');
    expect(rules[0].sources[0].locator.lineStart).toBe(2);
    expect(await db.policyRuleVersion.count({ where: { state: 'REVIEWED' } })).toBe(0);
  });

  it('a deliberate rerun is a child attempt, not a duplicate', async () => {
    const { versionId, batchId } = await extractedRule();
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [versionId], parentBatchId: batchId });
    expect(r.statusCode).toBe(202);
    expect(r.json().batchId).not.toBe(batchId);
    expect((await db.extractionBatch.findUniqueOrThrow({ where: { id: r.json().batchId } })).parentBatchId).toBe(batchId);
  });

  it('keeps a quote that is not in the document as Needs definition', async () => {
    await enableDefaultProfile();
    llama.mode = 'bad-quote';
    const versionId = await uploadedVersion();
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [versionId] });
    await worker(r.json().jobs[0].id);
    const rules = (await api(pmCookie).get(`/projects/${projectId}/policy/rules`)).json().items;
    expect(rules[0].state).toBe('NEEDS_DEFINITION');
    expect(rules[0].sources[0].resolution).toBe('QUOTE_MISMATCH');
  });

  it('records provider failure, and marks an ambiguous submit Uncertain without resubmitting', async () => {
    await enableDefaultProfile();
    llama.mode = 'fail';
    const v = await uploadedVersion();
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [v] });
    await worker(r.json().jobs[0].id);
    expect(await db.extractionJob.findUniqueOrThrow({ where: { id: r.json().jobs[0].id } })).toMatchObject({ status: 'FAILED', error: 'Provider rejected the file.' });

    llama.mode = 'ambiguous';
    const r2 = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [v], parentBatchId: r.json().batchId });
    await worker(r2.json().jobs[0].id);
    await worker(r2.json().jobs[0].id);
    expect((await db.extractionJob.findUniqueOrThrow({ where: { id: r2.json().jobs[0].id } })).status).toBe('UNCERTAIN');
    expect(llama.calls.submit).toBe(2);
  });

  it('refuses a job that would exceed the provider budget, before any call', async () => {
    await enableDefaultProfile();
    await db.extractionSpend.create({ data: { clientId, provider: 'llamaextract', jobId: randomUUID(), kind: 'RESERVE', amountUsd: '19.95' } });
    const v = await uploadedVersion();
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [v] });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('BUDGET_EXHAUSTED');
    expect(llama.calls.submit).toBe(0);
  });

  it('only an Admin may choose the provider; the project setting is used and audited', async () => {
    const v = await uploadedVersion();
    const pm = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [v], profileId: 'google-layout-gemini-v1' });
    expect(pm.statusCode).toBe(403);
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/extraction/profile`, { profileId: 'google-layout-gemini-v1' })).statusCode).toBe(403);
    await api(adminCookie).patch('/policy/extraction-profiles/google-layout-gemini-v1', { enabled: true });
    expect((await api(adminCookie).put(`/projects/${projectId}/policy/extraction/profile`, { profileId: 'google-layout-gemini-v1' })).statusCode).toBe(200);
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [v] });
    expect(r.statusCode).toBe(202);
    expect((await db.extractionBatch.findUniqueOrThrow({ where: { id: r.json().batchId } })).selectionSource).toBe('project');
    expect(await db.auditEvent.count({ where: { action: 'policy.extraction_profile_set' } })).toBe(1);
  });
});

describe('review and publication (AC06–AC08, AC17–AC18, owner checks)', () => {
  it('the PM marks a complete rule Reviewed (D-R1); stale decisions are rejected; edits create a new draft', async () => {
    const { rule } = await extractedRule();
    const stale = await api(pmCookie).post(`/projects/${projectId}/policy/rule-versions/${rule.versionId}/review`, { expectedContentHash: 'a'.repeat(64) });
    expect(stale.statusCode).toBe(409);
    const ok = await api(pmCookie).post(`/projects/${projectId}/policy/rule-versions/${rule.versionId}/review`, { expectedContentHash: rule.contentHash, required: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state).toBe('REVIEWED');

    const detail = (await api(pmCookie).get(`/projects/${projectId}/policy/rule-versions/${rule.versionId}`)).json();
    const edited = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${rule.ruleId}`, { expectedContentHash: detail.contentHash, body: { ...detail.body, requirement: `${detail.body.requirement} Keep the record.` } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ version: 2, state: 'DRAFT' });
    const v1 = await db.policyRuleVersion.findUniqueOrThrow({ where: { id: rule.versionId } });
    expect(v1.state).toBe('REVIEWED');
    await expect(db.$executeRawUnsafe(`UPDATE "PolicyRuleVersion" SET body = '{}' WHERE id = '${rule.versionId}'`)).rejects.toThrow();
  });

  it('an incomplete rule cannot be reviewed; Exclude needs a reason', async () => {
    await enableDefaultProfile();
    llama.mode = 'bad-quote';
    const v = await uploadedVersion();
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [v] });
    await worker(r.json().jobs[0].id);
    const rule = (await api(pmCookie).get(`/projects/${projectId}/policy/rules`)).json().items[0];
    const review = await api(pmCookie).post(`/projects/${projectId}/policy/rule-versions/${rule.versionId}/review`, { expectedContentHash: rule.contentHash });
    expect(review.statusCode).toBe(422);
    expect(review.json().message).toContain('Link the requirement to a quote');
    const ex = await api(pmCookie).post(`/projects/${projectId}/policy/rule-versions/${rule.versionId}/exclude`, { expectedContentHash: rule.contentHash, reason: 'Not a requirement for this project.' });
    expect(ex.json().state).toBe('EXCLUDED');
  });

  it('publication is blocked until rules are reviewed, then immutable and idempotent; tasks inherit it', async () => {
    const { rule } = await extractedRule();
    const blocked = await api(pmCookie).post(`/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: null });
    expect(blocked.statusCode).toBe(422);
    await api(pmCookie).post(`/projects/${projectId}/policy/rule-versions/${rule.versionId}/review`, { expectedContentHash: rule.contentHash });
    const preview = (await api(pmCookie).get(`/projects/${projectId}/policy/rule-set/preview`)).json();
    expect(preview).toMatchObject({ blocking: [], inheritanceMode: 'ALL_TASKS', affectedTasks: 1 });
    const pub = await api(pmCookie).post(`/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: null });
    expect(pub.statusCode).toBe(201);
    const again = await api(pmCookie).post(`/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: 1 });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(pub.json().id);
    const stale = await api(pmCookie).post(`/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: null });
    expect(stale.statusCode).toBe(200);

    const task = (await api(pmCookie).get(`/tasks/${taskId}/policy`)).json();
    expect(task.configured).toBe(true);
    expect(task.rules[0]).toMatchObject({ rule_key: 'R-APPROVAL', applicability_label: expect.stringContaining('schedule launch event') });
    expect(task.readiness.anvil).toBe('Not tested');
  });

  it('detects the same rule ID with different content as a blocking conflict', async () => {
    const { versionId } = await extractedRule();
    const make = (requirement: string) =>
      api(pmCookie).post(`/projects/${projectId}/policy/rules`, {
        documentVersionId: versionId,
        ruleKey: 'REFUNDS',
        body: { title: 'Refunds', requirement, requirementType: 'prohibition', visibility: 'agent_visible', applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: null, to: null, conditionText: 'always' }, evidenceNeeds: [], verificationHint: null, uncertainty: [] },
        citations: [{ fieldPath: 'requirement', role: 'supports', quote: 'Refunds are out of scope.' }],
      });
    expect((await make('Do not process refunds.')).statusCode).toBe(201);
    expect((await make('Refunds may be processed by agents.')).statusCode).toBe(201);
    const preview = (await api(pmCookie).get(`/projects/${projectId}/policy/rule-set/preview`)).json();
    expect(preview.conflicts.map((c: { kind: string }) => c.kind)).toContain('same_rule_id_different_content');
  });
});

describe('task changes and snapshots (AC09–AC12, AC16)', () => {
  async function published() {
    const { rule } = await extractedRule();
    await api(pmCookie).post(`/projects/${projectId}/policy/rule-versions/${rule.versionId}/review`, { expectedContentHash: rule.contentHash });
    await api(pmCookie).post(`/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: null });
    return rule;
  }

  it('a legacy task without a rule set is Not configured and unchanged', async () => {
    const r = (await api(pmCookie).get(`/tasks/${taskId}/policy`)).json();
    expect(r).toMatchObject({ configured: false, anvil: 'Not tested' });
  });

  it('refuses an exemption when the rule defines no exception; accepts a clarification', async () => {
    const rule = await published();
    const ex = await api(pmCookie).post(`/tasks/${taskId}/policy/changes`, { ruleVersionId: rule.versionId, type: 'EXEMPTION', requirement: 'Skip approval', scope: {}, reason: 'Urgent', sourceCitationId: null, exceptionIndex: null });
    expect(ex.statusCode).toBe(422);
    expect(ex.json().error).toBe('EXEMPTION_NOT_ALLOWED');
    const cl = await api(pmCookie).post(`/tasks/${taskId}/policy/changes`, { ruleVersionId: rule.versionId, type: 'CLARIFICATION', requirement: 'Approval means an email from the line manager.', scope: {}, reason: 'Make the evidence clear.', sourceCitationId: null, exceptionIndex: null });
    expect(cl.statusCode).toBe(201);
  });

  it('publishes an immutable snapshot with a digest; identical content is idempotent; the sidecar exports it', async () => {
    await published();
    const a = await api(pmCookie).post(`/tasks/${taskId}/policy/snapshot`, {});
    expect(a.statusCode).toBe(201);
    const b = await api(pmCookie).post(`/tasks/${taskId}/policy/snapshot`, {});
    expect(b.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    const exp = await api(pmCookie).get(`/tasks/${taskId}/policy/snapshots/${a.json().id}/export`);
    expect(exp.json()).toMatchObject({ schema_version: 'praxis.anvil.policy.v1-proposed', task_id: taskId, digest: a.json().digest });
    expect(exp.body).not.toMatch(/api[_-]?key|password|secret/i);
    await expect(db.$executeRawUnsafe(`UPDATE "TaskPolicySnapshot" SET digest = 'x' WHERE id = '${a.json().id}'`)).rejects.toThrow();
  });
});
