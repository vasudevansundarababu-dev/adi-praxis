/**
 * Local link check (adi-labs-design praxis/AUTHORING-LOCAL-SETUP.md 5): runs Authoring in-process against a throwaway
 * database and makes REAL calls to the local RL Gym (and Studio, when set). Never run against the dev or QA database.
 *
 *   1. A Studio-shaped proposal: the KYC joint proposal with Studio's S4 edge cases projected exactly as Studio's
 *      `praxis_wire.EDGE_CASE_PUBLIC` does (read from the Studio repo if STUDIO_EDGE_CASES_FILE is set). Validated and
 *      proposed; the edge cases show on the template version.
 *   2. A Golden KYC project with approved tasks (the embedded KYC v8 tasks), qualified with the RL Gym's own template
 *      identity (RLGYM_TEMPLATE_ID, RLGYM_TEMPLATE_VERSION, RLGYM_SPEC_SHA256: an active activation in the workspace).
 *   3. Export for benchmark: POST {RLGYM_API_URL}/api/v1/workspaces/{RLGYM_WORKSPACE}/projects/{id}/exports.
 *
 * The RL Gym fetches each package from the Authoring it is configured with (RLGYM_FORGE_URL). Until the owner points it
 * at this Authoring, it fetches from its stub on 8212 and refuses the packages; the export still reaches the route.
 *
 *   DATABASE_URL=postgresql://…/praxis_local_check RLGYM_API_URL=… RLGYM_WORKSPACE=… RLGYM_FORGE_CLIENT_KEY=… \
 *   RLGYM_TEMPLATE_ID=… RLGYM_TEMPLATE_VERSION=… RLGYM_SPEC_SHA256=… pnpm --filter @praxis/api exec tsx scripts/local-link-check.ts
 */
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { jointHashes, jointTemplateSpec, type JointTemplateSpec } from '../src/anvil/joint-template';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { loadConfig } from '../src/config';
import { writeApprovedRecord } from '../src/dataset/approved-records';
import { createDb } from '../src/db';
import { loadKycV8Inputs, successorTemplate } from '../src/jobs/kyc-v8-successor';
import { hashPassword } from '../src/auth/password';
import { MemoryEmailSender } from '../src/lib/email';
import { templateVersionHash } from '../src/routes/anvil-templates';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';

const url = process.env.DATABASE_URL ?? '';
if (!/\/praxis_local_check(\?|$)/.test(url)) throw new Error('Refusing to run: DATABASE_URL must name the throwaway database praxis_local_check.');
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const EDGE_PUBLIC = ['tag', 'archetype', 'complexity', 'products', 'context', 'twist'];
const ADMIN = 'admin@local-check.test';
const PASSWORD = 'local-check-password-123';

async function main() {
  const db = createDb(url);
  const config = loadConfig({ ...process.env, NODE_ENV: 'development', LOGIN_RATE_LIMIT_PER_MINUTE: '1000', ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  let clientId = '';
  const app = await buildApp({ config, db, pingRedis: async () => true, google: new MockGoogleVerifier('local-check'), identity: new MockIdentityProvider('local-check', 'http://candidate.local'), resolveClientId: async () => clientId, storage: new MemoryStorage(), email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider() });
  const say = (s: string) => console.log(s);
  try {
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: ADMIN, SEED_ADMIN_PASSWORD: PASSWORD, TASKFLOW_PATH: '/none' });
    clientId = client.id;
    const loginAs = async (email: string, password: string) => {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
      if (r.statusCode !== 200) throw new Error(`login ${r.statusCode}`);
      return `praxis_session=${r.cookies.find((c) => c.name === 'praxis_session')!.value}`;
    };
    const admin = await loginAs(ADMIN, PASSWORD);
    const pmUser = await db.user.create({ data: { clientId, email: `pm-${randomUUID().slice(0, 6)}@local-check.test`, name: 'Local PM', roles: ['PM'], passwordHash: await hashPassword(PASSWORD) } });
    const pm = await loginAs(pmUser.email, PASSWORD);
    const call = (cookie: string, method: 'GET' | 'POST' | 'PUT', path: string, payload?: object) => app.inject({ method, url: `/api/v1${path}`, headers: { cookie, ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }) }, ...(payload ? { payload } : {}) });
    const anvilKey = (await call(admin, 'POST', '/api-clients', { name: 'RL Gym local', kind: 'ANVIL' })).json().key as string;
    const gym = (method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: `/api/v1${path}`, headers: { authorization: `Bearer ${anvilKey}`, ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}) }, ...(payload ? { payload } : {}) });

    // 1 · A Studio-shaped proposal with S4 edge cases.
    const V7 = JSON.parse(readFileSync(new URL('../test/fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
    const studioEdges = process.env.STUDIO_EDGE_CASES_FILE ? (JSON.parse(readFileSync(process.env.STUDIO_EDGE_CASES_FILE, 'utf8')).edge_cases as Record<string, unknown>[]) : [];
    const edges: { tag: string; [k: string]: unknown }[] = studioEdges.map((e) => ({ tag: String(e.tag), ...Object.fromEntries(EDGE_PUBLIC.filter((k) => e[k] !== undefined && e[k] !== '' && !(Array.isArray(e[k]) && !(e[k] as unknown[]).length)).map((k) => [k, e[k]])), ...(String(e.source ?? '').startsWith('inb-') ? { source: e.source } : {}) }));
    const domainId = (await call(admin, 'POST', '/domains', { name: 'Banking' })).json().id;
    const base = (await call(admin, 'POST', '/templates', { domainId, workflowName: 'KYC onboarding and refresh', primaryWork: 'KYC.', verificationCriteria: 'Checked.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    await call(admin, 'POST', `/templates/${base.id}/publish`);
    const proposal = structuredClone(V7);
    proposal.authoring.edge_cases = edges;
    const validated = await gym('POST', '/integrations/anvil/templates/validate', proposal);
    say(`1. Studio-shaped proposal with ${edges.length} edge cases (${edges.map((e) => e.tag).join(', ')}): validate ${validated.statusCode} valid=${validated.json().data?.valid}`);
    const leaky = structuredClone(proposal);
    if (studioEdges[0]) leaky.authoring.edge_cases[0] = { ...leaky.authoring.edge_cases[0], recipe: studioEdges[0].recipe, outcome: studioEdges[0].outcome };
    const refused = await gym('POST', '/integrations/anvil/templates/validate', leaky);
    say(`   the same with Studio's recipe and outcome left in: ${refused.statusCode} ${refused.json().data?.errors?.map((e: { code: string; pointer: string }) => `${e.code} ${e.pointer}`).join('; ')}`);
    const proposed = await gym('POST', '/integrations/anvil/templates/proposals', proposal);
    const v7Id = proposed.json().data.template_version_id as string;
    await call(admin, 'POST', `/templates/${v7Id}/publish`);
    const shown = (await call(pm, 'GET', `/templates/${v7Id}/benchmark`)).json();
    say(`   proposed ${proposed.statusCode}; Templates → version detail shows edge cases: ${shown.edgeCases.map((e: { tag: string }) => e.tag).join(', ') || '(none)'}`);

    // 2 · Golden KYC project with approved tasks, on the KYC v8 successor carrying the same edge cases.
    const v7 = await db.template.findUniqueOrThrow({ where: { id: v7Id } });
    const EMBEDDED = loadKycV8Inputs();
    const spec = structuredClone(EMBEDDED.spec) as JointTemplateSpec;
    spec.template_id = v7.lineageId;
    spec.version = v7.version + 1;
    spec.requirement.successor_of = { template_id: v7.lineageId, version: v7.version, template_sha256: jointHashes(jointTemplateSpec(v7)!).template_sha256 };
    const made = await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: ADMIN, apply: true, spec });
    const v8Id = made.v8!.templateVersionId!;
    const row = await db.template.findUniqueOrThrow({ where: { id: v8Id } });
    const anvilSpec = structuredClone(row.anvilSpec) as Record<string, any>;
    anvilSpec.authoring.edge_cases = edges;
    await db.template.update({ where: { id: v8Id }, data: { anvilSpec } });
    await call(admin, 'POST', `/templates/${v8Id}/publish`);
    const v8 = await db.template.findUniqueOrThrow({ where: { id: v8Id } });
    const q = await gym('POST', '/integrations/anvil/templates/qualifications', { template_id: v8.lineageId, version: v8.version, template_version_hash: templateVersionHash(v8), status: 'QUALIFIED', receipt_id: `tq-local-${randomUUID().slice(0, 8)}`, receipt: { rlgym_template_id: need('RLGYM_TEMPLATE_ID'), rlgym_template_version: Number(need('RLGYM_TEMPLATE_VERSION')), spec_sha256: need('RLGYM_SPEC_SHA256') } });
    await call(admin, 'PUT', '/admin/forge-settings', { newFlow: true });
    const jd = (await call(pm, 'POST', '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: v8.skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await call(pm, 'POST', '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: v8.id, name: 'KYC November (local check)', taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-11-05', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
    const projectId = created.json().id as string;
    await call(pm, 'POST', `/projects/${projectId}/submit`);
    const reviewer = await db.user.create({ data: { clientId, email: `rev-${randomUUID().slice(0, 6)}@local-check.test`, name: 'Local reviewer', roles: ['ADMIN'], passwordHash: await hashPassword(PASSWORD) } });
    const tasks = await db.taskInstance.findMany({ where: { projectId } });
    let i = 0;
    for (const { candidate } of EMBEDDED.successors.values()) {
      const value = candidate.output.sections.S1!.applicationType as string;
      const task = tasks.find((t) => (t.input as { slot: { case: { value: string } } }).slot.case.value === value)!;
      const sme = await db.smeUser.create({ data: { clientId, contactEmail: `${value}-${i}@sme.local-check.test` } });
      const cand = await db.candidate.create({ data: { clientId, smeUserId: sme.id } });
      const focus = i === 0 && edges[0] ? { edgeCase: edges[0].tag, slots: {}, extraStateChecks: [], version: 1 } : null;
      await db.taskInstance.update({ where: { id: task.id }, data: { status: 'ACCEPTED', assignedToId: cand.id, assignedAt: new Date(), submittedAt: new Date(), output: candidate.output as unknown as Prisma.InputJsonValue, ...(focus ? { benchmark: focus as Prisma.InputJsonValue } : {}) } });
      await db.taskSubmission.create({ data: { clientId, taskInstanceId: task.id, version: 1, output: candidate.output as unknown as Prisma.InputJsonValue, checks: {} } });
      await db.$transaction((tx) => writeApprovedRecord(tx, { taskId: task.id, reviewerId: reviewer.id, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() }));
      i += 1;
    }
    const state = (await call(pm, 'GET', `/projects/${projectId}/rlgym-export`)).json();
    say(`2. Project ${projectId} with ${state.tasks.length} approved tasks; qualification ${q.statusCode}; RL Gym template ${JSON.stringify(state.rlgymTemplate)}; canExport=${state.canExport} ${state.reason ?? ''}`);

    // 3 · Export for benchmark: a real call to the RL Gym's export route.
    const exp = await call(pm, 'POST', `/projects/${projectId}/rlgym-exports`, {});
    const run = exp.json();
    say(`3. Export for benchmark → Authoring ${exp.statusCode}; sent ${run.tasks?.length ?? 0} task(s), not sent ${run.notSent?.length ?? 0}`);
    say(`   RL Gym answered HTTP ${run.httpStatus}: outcome ${run.outcome}${run.receipt ? ` receipt ${JSON.stringify(run.receipt)}` : ''}${run.error ? ` error ${run.error.code}: ${run.error.message}` : ''}`);
    for (const t of (run.tasks ?? []) as { title: string; complexity: string | null; archetype: string | null; edgeCase: string | null }[]) say(`   task ${t.title}: complexity=${t.complexity} archetype=${t.archetype} edge_case=${t.edgeCase}`);
    for (const n of (run.notSent ?? []) as { title: string; code: string }[]) say(`   not sent: ${n.title} (${n.code})`);
  } finally {
    await app.close();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
