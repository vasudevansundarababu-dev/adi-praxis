import {
  BLUEPRINT_SECTIONS,
  HarborBlueprint,
  ProposeFieldRequest,
  SaveBlueprintRequest,
  SaveVariantRequest,
  StartGenerationRequest,
  CreateDeploymentRequest,
  sectionProblems,
  slugify,
  validSectionCount,
  VERIFICATION_CHECK_IDS,
  type BlueprintResponse,
  type CustomField,
  type DomainDto,
  type ElicitationPresetDto,
  type GenerationRunDto,
  type ProjectDto,
  type SmeAuthoredTaskDto,
  type StudioDeploymentDto,
  type TemplateDirectoryResponse,
  type TemplateDto,
  type VerificationRunDto,
  type DirectoryRowDto,
} from '@praxis/shared';
import { blueprintForTemplate, sampleBlueprintInput } from './fixtures';

/**
 * Typed stand-in for the Stream 2 Meta-Compiler routes (architecture §5), used while MC_API_MODE is `mock`.
 * Template, domain and project data come from the real API (`MockSource`); everything new lives in memory.
 * Delete this file when the real routes land.
 */

export interface MockSource {
  templates(): Promise<TemplateDto[]>;
  domains(): Promise<DomainDto[]>;
  template(id: string): Promise<TemplateDto | null>;
  versions(id: string): Promise<TemplateDto[]>;
  projects(): Promise<ProjectDto[]>;
}

export interface MockContext {
  roles: string[];
  source: MockSource;
  now?: () => number;
  candidateAppUrl?: string;
}

export interface MockResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

interface Store {
  blueprints: Map<string, { blueprint: HarborBlueprint; revision: number }>;
  variants: Map<string, TemplateDto>;
  generations: Map<string, GenerationRunDto & { createdMs: number }>;
  verifications: Map<string, VerificationRunDto & { createdMs: number }>;
  deployments: Map<string, StudioDeploymentDto & { projectName: string; smeEmail: string; lineageId: string }>;
  tasks: Map<string, { dto: SmeAuthoredTaskDto; taskJson: unknown }>;
}

const KEY = '__praxisMcMockStore';
export function mockStore(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  return (g[KEY] ??= { blueprints: new Map(), variants: new Map(), generations: new Map(), verifications: new Map(), deployments: new Map(), tasks: new Map() });
}
export function resetMockStore() {
  delete (globalThis as unknown as Record<string, unknown>)[KEY];
}

const json = (status: number, body: unknown): MockResult => ({ status, body });
const error = (status: number, code: string, message: string) => json(status, { error: code, message });
const isAdmin = (ctx: MockContext) => ctx.roles.includes('ADMIN');

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic UUID-shaped id from a seed (keeps mock ids stable across reloads). */
function seededUuid(seed: string): string {
  const h = [0, 1, 2, 3].map((i) => hash(`${seed}:${i}`)).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
let counter = 0;
const newId = (kind: string) => seededUuid(`${kind}:${Date.now()}:${counter++}:${Math.random()}`);

async function findTemplate(ctx: MockContext, id: string): Promise<TemplateDto | null> {
  return mockStore().variants.get(id) ?? (await ctx.source.template(id));
}

async function allTemplates(ctx: MockContext): Promise<TemplateDto[]> {
  const real = await ctx.source.templates();
  const variants = isAdmin(ctx) ? [...mockStore().variants.values()] : [];
  return [...real, ...variants];
}

function entry(t: TemplateDto) {
  const s = mockStore();
  let e = s.blueprints.get(t.id);
  if (!e) {
    e = { blueprint: blueprintForTemplate(t), revision: 0 };
    s.blueprints.set(t.id, e);
  }
  return e;
}

function blueprintResponse(t: TemplateDto): BlueprintResponse {
  const e = entry(t);
  const problems = sectionProblems(e.blueprint);
  return {
    templateId: t.id,
    lineageId: t.lineageId,
    version: t.version,
    templateStatus: t.status,
    editable: t.status === 'DRAFT',
    blueprint: e.blueprint,
    blueprintRevision: e.revision,
    problems,
    validSections: validSectionCount(problems),
    variantOfId: mockStore().variants.has(t.id) ? (t as TemplateDto & { variantOfId?: string }).variantOfId ?? null : null,
  };
}

function generationView(run: GenerationRunDto & { createdMs: number }, now: number): GenerationRunDto {
  const { createdMs, ...dto } = run;
  if (dto.status !== 'QUEUED' && dto.status !== 'RUNNING') return dto;
  const t = (now - createdMs) / 1000;
  const ui = Math.min(100, Math.round(t * 40));
  const backend = Math.min(100, Math.max(0, Math.round((t - 1.5) * 40)));
  const done = ui === 100 && backend === 100;
  const message = done ? 'Studio configuration and UISpec built.' : ui < 100 ? 'Compiling the SME studio UI from the UISpec…' : 'Building persistence and MCP simulator…';
  const out: GenerationRunDto = { ...dto, status: done ? 'SUCCEEDED' : t < 0.3 ? 'QUEUED' : 'RUNNING', progress: { ui, backend, message } };
  if (done) {
    out.finishedAt = new Date(createdMs + 4000).toISOString();
    out.actualCostUsd = 0;
    out.outputSha256 = hash(run.id).repeat(8);
    Object.assign(run, out);
  }
  return out;
}

const CHECK_VALUES: Record<(typeof VERIFICATION_CHECK_IDS)[number], [string, string]> = {
  '01_bundle_layout': ['task.json, instruction.md, eval/, solution/ present', 'Bundle manifest has 7 entries'],
  '02_hidden_paths': ['0 hidden paths in agent view', 'Agent workspace lists /workspace/inputs only'],
  '03_network_internal': ['--network=internal', 'Sandbox started with no egress'],
  '04_zero_baseline': ['0.00', 'Null agent scored 0.00 on eval/test_verifiers.py'],
  '05_oracle_solve': ['1.00', 'solution/solve.sh scored 1.00 on eval/test_verifiers.py'],
};

function verificationView(run: VerificationRunDto & { createdMs: number }, now: number): VerificationRunDto {
  const { createdMs, ...dto } = run;
  if (dto.status === 'SUCCEEDED' || dto.status === 'FAILED') return dto;
  const doneCount = Math.min(5, Math.floor((now - createdMs) / 900));
  const checks = VERIFICATION_CHECK_IDS.map((id, i) =>
    i < doneCount ? { id, passed: true, value: CHECK_VALUES[id][0], evidence: CHECK_VALUES[id][1] } : { id, passed: null, value: null, evidence: null },
  );
  const log = checks.filter((c) => c.passed !== null).map((c) => `[verifier] ${c.id}: PASS (${c.value})`);
  const done = doneCount === 5;
  const out: VerificationRunDto = {
    ...dto,
    status: done ? 'SUCCEEDED' : 'RUNNING',
    checks,
    zeroBaselineScore: doneCount >= 4 ? 0 : null,
    oracleScore: done ? 1 : null,
    bundleSha256: doneCount >= 1 ? hash(`${run.id}:bundle`).repeat(8) : null,
    logTail: ['[runner] mock runner, hermetic sandbox (--network=none)', ...log].join('\n'),
    finishedAt: done ? new Date(createdMs + 4500).toISOString() : null,
  };
  if (done) Object.assign(run, out);
  return out;
}

function presetsFor(domainId: string): ElicitationPresetDto[] {
  const field = (f: Partial<CustomField> & Pick<CustomField, 'field_id' | 'label' | 'input_type'>): CustomField => ({
    options: [],
    default_value: null,
    inject_into: ['instruction.md'],
    verifier_assertion: '',
    ...f,
  });
  const list: Array<[string, CustomField]> = [
    ['Creative Fatigue slider', field({ field_id: 'creative_fatigue', label: 'Creative fatigue decay', input_type: 'number_input', min: 0, max: 1, default_value: 0.15, inject_into: ['mcp_mock.py'] })],
    ['Target CAC ceiling $42', field({ field_id: 'target_cac_ceiling_usd', label: 'Target CAC ceiling (USD)', input_type: 'currency_slider', min: 10, max: 100, default_value: 42, inject_into: ['instruction.md', 'eval/test_verifiers.py'], verifier_assertion: "env_state['weekly_cac_usd'] <= 42" })],
    ['UBO hop depth', field({ field_id: 'ubo_hop_depth', label: 'UBO hop depth', input_type: 'number_input', min: 1, max: 6, default_value: 3, inject_into: ['task.json'] })],
    ['Holiday CPM multiplier', field({ field_id: 'holiday_cpm_multiplier', label: 'Holiday CPM multiplier', input_type: 'number_input', min: 1, max: 4, default_value: 1.8, inject_into: ['mcp_mock.py'] })],
  ];
  return list.map(([label, f], i) => ({ id: seededUuid(`preset:${domainId}:${i}`), label, field: f, sortOrder: i, active: true }));
}

/** Deterministic mock drafter: turns the Admin's text into a field proposal (D7). */
export function mockProposal(prompt: string): CustomField {
  const text = prompt.trim();
  const label = text.replace(/[.?!]+$/, '').slice(0, 60) || 'Custom field';
  const money = /\$\s?(\d+(?:\.\d+)?)/.exec(text);
  const list = /:\s*([^:]+,[^:]+)$/.exec(text);
  const base = { field_id: slugify(label).slice(0, 40), label, verifier_assertion: '', inject_into: ['instruction.md', 'task.json'] as CustomField['inject_into'] };
  if (money) {
    const v = Number(money[1]);
    return { ...base, input_type: 'currency_slider', options: [], default_value: v, min: 0, max: Math.max(1, Math.ceil(v * 2)) };
  }
  if (list) {
    const options = list[1]!.split(',').map((o) => o.trim()).filter(Boolean).slice(0, 20);
    return { ...base, label: text.split(':')[0]!.trim().slice(0, 60), field_id: slugify(text.split(':')[0]!).slice(0, 40), input_type: 'single_select', options, default_value: options[0] ?? null };
  }
  if (/^(whether|allow|enable|is |require)/i.test(text)) return { ...base, input_type: 'boolean_toggle', options: [], default_value: false };
  const num = /(\d+(?:\.\d+)?)/.exec(text);
  if (num) return { ...base, input_type: 'number_input', options: [], default_value: Number(num[1]) };
  return { ...base, input_type: 'text_input', options: [], default_value: '' };
}

function seedTasks(templates: TemplateDto[]) {
  const s = mockStore();
  if (s.tasks.size > 0 || templates.length === 0) return;
  const t = templates[0]!;
  const bp = blueprintForTemplate(t);
  for (let i = 0; i < 2; i++) {
    const id = seededUuid(`task:${t.id}:${i}`);
    const externalTaskId = `TASK-MKTG-${901 + i}`;
    const taskJson = {
      task_id: externalTaskId,
      template_id: bp.template_meta.template_id,
      title: i === 0 ? 'Q4 launch, UK only (synthetic)' : 'Holiday push with CAC cap (synthetic)',
      execution_mode: 'HERMETIC_MCP',
      data_classification: 'synthetic',
      network: 'internal',
      fields: { target_cac_ceiling: 42 - i * 4, launch_locales: ['en-GB'] },
    };
    s.tasks.set(id, {
      taskJson,
      dto: {
        id,
        externalTaskId,
        taskInstanceId: seededUuid(`ti:${id}`),
        submissionVersion: 1,
        templateId: t.id,
        templateVersion: t.version,
        workflowName: t.workflowName,
        projectId: seededUuid('project:demo'),
        projectName: 'SYNTHETIC Launch pilot',
        authoredBy: 'sme.demo@example.test',
        title: taskJson.title,
        executionMode: 'HERMETIC_MCP',
        bundleSha256: hash(id).repeat(8),
        zeroBaselineScore: 0,
        oracleScore: 1,
        dataClassification: 'SYNTHETIC',
        reviewStatus: i === 0 ? 'SUBMITTED' : 'ACCEPTED',
        createdAt: new Date(Date.UTC(2026, 10, 7, 10 + i)).toISOString(),
      },
    });
  }
}

type Route = { method: string; pattern: RegExp; admin?: boolean; run: (m: string[], body: unknown, ctx: MockContext) => Promise<MockResult> | MockResult };

type Schema<T> = { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } };
function parse<T>(schema: Schema<T>, body: unknown): T | MockResult {
  const r = schema.safeParse(body);
  return r.success ? r.data : error(400, 'VALIDATION_FAILED', r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; '));
}
const isResult = (v: unknown): v is MockResult => typeof v === 'object' && v !== null && 'status' in v && 'body' in v && Object.keys(v).length <= 3 && typeof (v as MockResult).status === 'number';

const routes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/templates\/directory$/,
    run: async (_m, _b, ctx) => {
      const admin = isAdmin(ctx);
      const [templates, domains] = await Promise.all([allTemplates(ctx), ctx.source.domains()]);
      const s = mockStore();
      seedTasks(templates);
      const deployments = [...s.deployments.values()];
      const rows = (t: TemplateDto): DirectoryRowDto => {
        const bp = entry(t).blueprint;
        const deps = deployments.filter((d) => d.templateId === t.id);
        const runs = [...s.generations.values()].filter((g) => g.templateId === t.id);
        const verified = [...s.verifications.values()].some((v) => v.status === 'SUCCEEDED' && runs.some((g) => g.id === v.generationRunId));
        const status: DirectoryRowDto['status'] = deps.some((d) => d.status === 'ACTIVE')
          ? 'ACTIVE'
          : verified
            ? 'VERIFIED'
            : runs.some((g) => g.status === 'RUNNING' || g.status === 'QUEUED')
              ? 'GENERATING'
              : t.status;
        return {
          templateId: t.id,
          lineageId: t.lineageId,
          version: t.version,
          workflowName: t.workflowName,
          templateStatus: t.status,
          status,
          tptMinutes: bp.template_meta.tpt_minutes,
          tptLabel: bp.template_meta.tpt_label || `${bp.domain_meta.horizon.max_turns} ${bp.domain_meta.horizon.cadence_unit}`.trim(),
          modes: bp.template_meta.modes,
          validSections: validSectionCount(sectionProblems(bp)),
          hasBlueprint: true,
          variantOfId: (t as TemplateDto & { variantOfId?: string }).variantOfId ?? null,
          projectCount: new Set(deps.map((d) => d.projectId)).size,
          authoredTaskCount: [...s.tasks.values()].filter((x) => x.dto.templateId === t.id).length,
          deployments: admin
            ? deps.map((d) => ({ id: d.id, projectId: d.projectId, projectName: d.projectName, status: d.status, smeEmail: d.smeEmail, studioUrl: d.studioUrl }))
            : [],
          updatedAt: t.updatedAt,
        };
      };
      const visible = admin ? templates : templates.filter((t) => t.status === 'PUBLISHED');
      const active = deployments.filter((d) => d.status === 'ACTIVE');
      const body: TemplateDirectoryResponse = {
        view: admin ? 'ADMIN' : 'PM',
        summary: {
          totalTemplates: visible.length,
          activeStudios: admin ? active.length : 0,
          attachedProjects: admin ? new Set(active.map((d) => d.projectId)).size : 0,
          attachedSmes: admin ? new Set(active.map((d) => d.smeCandidateId)).size : 0,
          authoredTasks: admin ? s.tasks.size : 0,
        },
        domains: domains
          .filter((d) => d.status === 'ACTIVE')
          .map((d) => ({ domainId: d.id, domainName: d.name, rows: visible.filter((t) => t.domainId === d.id).map(rows) }))
          .filter((d) => admin || d.rows.length > 0),
      };
      return json(200, body);
    },
  },
  {
    method: 'GET',
    pattern: /^\/templates\/([\w-]+)$/,
    run: async ([, id], _b, ctx) => {
      const t = await findTemplate(ctx, id!);
      return t ? json(200, t) : error(404, 'NOT_FOUND', 'Template not found');
    },
  },
  {
    method: 'GET',
    pattern: /^\/templates\/([\w-]+)\/versions$/,
    admin: true,
    run: async ([, id], _b, ctx) => {
      const v = mockStore().variants.get(id!);
      return json(200, { items: v ? [v] : await ctx.source.versions(id!) });
    },
  },
  {
    method: 'GET',
    pattern: /^\/templates\/([\w-]+)\/blueprint$/,
    run: async ([, id], _b, ctx) => {
      const t = await findTemplate(ctx, id!);
      if (!t || (!isAdmin(ctx) && t.status !== 'PUBLISHED')) return error(404, 'NOT_FOUND', 'Template not found');
      return json(200, blueprintResponse(t));
    },
  },
  {
    method: 'PUT',
    pattern: /^\/templates\/([\w-]+)\/blueprint$/,
    admin: true,
    run: async ([, id], body, ctx) => {
      const req = parse(SaveBlueprintRequest, body);
      if (isResult(req)) return req;
      const t = await findTemplate(ctx, id!);
      if (!t) return error(404, 'NOT_FOUND', 'Template not found');
      if (t.status !== 'DRAFT') return error(409, 'TEMPLATE_NOT_EDITABLE', 'Only a draft can be edited. Start a new version to make changes.');
      const e = entry(t);
      if (req.expectedRevision !== e.revision) return error(409, 'BLUEPRINT_CONFLICT', `Another Admin saved revision ${e.revision} after you opened this template.`);
      e.blueprint = HarborBlueprint.parse(req.blueprint);
      e.revision += 1;
      return json(200, blueprintResponse(t));
    },
  },
  {
    method: 'POST',
    pattern: /^\/templates\/([\w-]+)\/variant$/,
    admin: true,
    run: async ([, id], body, ctx) => {
      const req = parse(SaveVariantRequest, body);
      if (isResult(req)) return req;
      const t = await findTemplate(ctx, id!);
      if (!t) return error(404, 'NOT_FOUND', 'Template not found');
      const siblings = (await allTemplates(ctx)).filter((x) => x.domainId === t.domainId);
      if (siblings.some((x) => x.workflowName.trim().toLowerCase() === req.label.trim().toLowerCase())) {
        return error(409, 'VARIANT_LABEL_TAKEN', `A workflow called "${req.label}" already exists in ${t.domainName}.`);
      }
      const vid = newId('variant');
      const variant: TemplateDto & { variantOfId: string } = { ...t, id: vid, lineageId: newId('lineage'), version: 1, status: 'DRAFT', workflowName: req.label, publishedAt: null, retiredAt: null, variantOfId: t.id };
      const s = mockStore();
      s.variants.set(vid, variant);
      const bp = HarborBlueprint.parse({ ...entry(t).blueprint, template_meta: { ...entry(t).blueprint.template_meta, label: req.label, version: 1, template_id: vid } });
      s.blueprints.set(vid, { blueprint: bp, revision: 0 });
      return json(201, { templateId: vid, lineageId: variant.lineageId, version: 1, variantOfId: t.id });
    },
  },
  {
    method: 'GET',
    pattern: /^\/templates\/([\w-]+)\/uispec$/,
    admin: true,
    run: async ([, id], _b, ctx) => {
      const t = await findTemplate(ctx, id!);
      if (!t) return error(404, 'NOT_FOUND', 'Template not found');
      return { status: 200, body: entry(t).blueprint, headers: { 'content-disposition': `attachment; filename="${entry(t).blueprint.studio_id || 'template'}.UISpec.json"` } };
    },
  },
  {
    method: 'GET',
    pattern: /^\/domains\/([\w-]+)\/presets$/,
    admin: true,
    run: ([, id]) => json(200, { items: presetsFor(id!) }),
  },
  {
    method: 'POST',
    pattern: /^\/templates\/([\w-]+)\/assistant\/propose-field$/,
    admin: true,
    run: (_m, body) => {
      const req = parse(ProposeFieldRequest, body);
      if (isResult(req)) return req;
      if (process.env.MC_MOCK_AI_OFF === '1') {
        return json(200, { proposal: null, problems: [], provider: 'mock', model: 'mock', costUsd: 0, unavailableReason: 'AI drafting is switched off in this environment. Add the field by hand with + Add Custom Field.' });
      }
      return json(200, { proposal: mockProposal(req.prompt), problems: [], provider: 'mock', model: 'mock-drafter', costUsd: 0, unavailableReason: null });
    },
  },
  {
    method: 'GET',
    pattern: /^\/meta-compiler\/models$/,
    admin: true,
    run: () =>
      json(200, {
        items: [
          { provider: 'claude', model: 'claude-sonnet-5', label: 'Claude Sonnet 5 (Vertex AI)', available: true },
          { provider: 'gemini', model: 'gemini-3-pro', label: 'Gemini 3 Pro (Vertex AI)', available: true },
          { provider: 'gemini', model: 'gemini-3-flash', label: 'Gemini 3 Flash (Vertex AI)', available: false },
        ],
      }),
  },
  {
    method: 'POST',
    pattern: /^\/templates\/([\w-]+)\/generations$/,
    admin: true,
    run: async ([, id], body, ctx) => {
      const req = parse(StartGenerationRequest, body);
      if (isResult(req)) return req;
      const t = await findTemplate(ctx, id!);
      if (!t) return error(404, 'NOT_FOUND', 'Template not found');
      const e = entry(t);
      if (validSectionCount(sectionProblems(e.blueprint)) !== BLUEPRINT_SECTIONS.length) return error(409, 'BLUEPRINT_INCOMPLETE', 'All 6 sections must be valid before generating.');
      const now = (ctx.now ?? Date.now)();
      const id2 = seededUuid(`gen:${t.id}:${e.revision}:${req.model}:${req.mode}`);
      const s = mockStore();
      const existing = s.generations.get(id2);
      if (existing) return json(200, generationView(existing, now));
      const run = {
        id: id2,
        templateId: t.id,
        templateVersion: t.version,
        mode: req.mode,
        provider: req.provider,
        model: req.model,
        status: 'QUEUED' as const,
        progress: { ui: 0, backend: 0, message: 'Queued' },
        estimatedCostUsd: 0.42,
        actualCostUsd: null,
        outputSha256: null,
        error: null,
        createdAt: new Date(now).toISOString(),
        finishedAt: null,
        createdMs: now,
      };
      s.generations.set(run.id, run);
      return json(201, generationView(run, now));
    },
  },
  {
    method: 'GET',
    pattern: /^\/generations\/([\w-]+)$/,
    admin: true,
    run: ([, id], _b, ctx) => {
      const run = mockStore().generations.get(id!);
      return run ? json(200, generationView(run, (ctx.now ?? Date.now)())) : error(404, 'NOT_FOUND', 'Generation run not found');
    },
  },
  {
    method: 'POST',
    pattern: /^\/generations\/([\w-]+)\/verifications$/,
    admin: true,
    run: ([, id], _b, ctx) => {
      const s = mockStore();
      const gen = s.generations.get(id!);
      const now = (ctx.now ?? Date.now)();
      if (!gen) return error(404, 'NOT_FOUND', 'Generation run not found');
      if (generationView(gen, now).status !== 'SUCCEEDED') return error(409, 'GENERATION_NOT_SUCCEEDED', 'Step 2 starts after Step 1 succeeds.');
      const run = {
        id: newId('ver'),
        generationRunId: gen.id,
        status: 'QUEUED' as const,
        checks: VERIFICATION_CHECK_IDS.map((cid) => ({ id: cid, passed: null, value: null, evidence: null })),
        zeroBaselineScore: null,
        oracleScore: null,
        bundleSha256: null,
        logTail: '',
        createdAt: new Date(now).toISOString(),
        finishedAt: null,
        createdMs: now,
      };
      s.verifications.set(run.id, run);
      return json(201, verificationView(run, now));
    },
  },
  {
    method: 'GET',
    pattern: /^\/verifications\/([\w-]+)$/,
    admin: true,
    run: ([, id], _b, ctx) => {
      const run = mockStore().verifications.get(id!);
      return run ? json(200, verificationView(run, (ctx.now ?? Date.now)())) : error(404, 'NOT_FOUND', 'Verification run not found');
    },
  },
  {
    method: 'POST',
    pattern: /^\/templates\/([\w-]+)\/deployments$/,
    admin: true,
    run: async ([, id], body, ctx) => {
      const req = parse(CreateDeploymentRequest, body);
      if (isResult(req)) return req;
      const t = await findTemplate(ctx, id!);
      if (!t) return error(404, 'NOT_FOUND', 'Template not found');
      const s = mockStore();
      const ver = s.verifications.get(req.verificationRunId);
      const v = ver && verificationView(ver, (ctx.now ?? Date.now)());
      if (!v || v.status !== 'SUCCEEDED' || v.zeroBaselineScore !== 0 || v.oracleScore !== 1) return error(409, 'GATES_NOT_PASSED', 'Checks 04 (zero-baseline 0.00) and 05 (oracle 1.00) must pass before deploying.');
      const project = (await ctx.source.projects()).find((p) => p.id === req.projectId);
      if (!project) return error(404, 'NOT_FOUND', 'Project not found');
      const key = `${entry(t).blueprint.studio_id || 'studio'}-${hash(`${t.lineageId}:${req.projectId}:${req.smeCandidateId}`).slice(0, 6)}`;
      const existing = [...s.deployments.values()].find((d) => d.studioKey === key);
      for (const d of s.deployments.values()) if (d.studioKey === key) d.status = 'STOPPED';
      const dep = {
        id: existing?.id ?? newId('dep'),
        templateId: t.id,
        templateVersion: t.version,
        projectId: req.projectId,
        smeCandidateId: req.smeCandidateId,
        studioKey: key,
        studioUrl: `${ctx.candidateAppUrl ?? 'http://localhost:3101'}/studio/${key}`,
        status: 'ACTIVE' as const,
        runtime: 'SHARED' as const,
        createdAt: new Date((ctx.now ?? Date.now)()).toISOString(),
        projectName: project.name,
        smeEmail: `sme-${req.smeCandidateId.slice(0, 6)}@example.test`,
        lineageId: t.lineageId,
      };
      s.deployments.set(dep.id, dep);
      const { projectName: _p, smeEmail: _e, lineageId: _l, ...dto } = dep;
      return json(201, dto);
    },
  },
  {
    method: 'GET',
    pattern: /^\/studio-tasks$/,
    admin: true,
    run: async (_m, _b, ctx) => {
      seedTasks(await allTemplates(ctx));
      return json(200, { items: [...mockStore().tasks.values()].map((t) => t.dto) });
    },
  },
  {
    method: 'GET',
    pattern: /^\/studio-tasks\/export$/,
    admin: true,
    run: () => ({
      status: 200,
      body: { exportedAt: new Date().toISOString(), items: [...mockStore().tasks.values()].map((t) => ({ ...t.dto, taskJson: t.taskJson })) },
      headers: { 'content-disposition': 'attachment; filename="studio-tasks.json"' },
    }),
  },
  {
    method: 'GET',
    pattern: /^\/studio-tasks\/([\w-]+)$/,
    admin: true,
    run: ([, id]) => {
      const t = mockStore().tasks.get(id!);
      return t ? json(200, { ...t.dto, taskJson: t.taskJson }) : error(404, 'NOT_FOUND', 'Task not found');
    },
  },
  {
    method: 'GET',
    pattern: /^\/studio-tasks\/([\w-]+)\/bundle$/,
    admin: true,
    run: ([, id]) => {
      const t = mockStore().tasks.get(id!);
      if (!t) return error(404, 'NOT_FOUND', 'Task not found');
      return { status: 200, body: { mockBundle: true, note: 'Mock bundle: the real route returns the Harbor .tar.gz', task: t.taskJson }, headers: { 'content-disposition': `attachment; filename="${t.dto.externalTaskId}.mock.json"` } };
    },
  },
];

export async function handleMock(method: string, path: string, body: unknown, ctx: MockContext): Promise<MockResult> {
  const clean = path.split('?')[0]!.replace(/\/+$/, '');
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(clean);
    if (!m) continue;
    if (r.admin && !isAdmin(ctx)) return error(403, 'FORBIDDEN', 'Admins only');
    return r.run([...m].map((x) => x ?? ''), body, ctx);
  }
  return error(404, 'NOT_FOUND', `No mock route for ${method} ${clean}`);
}

/** Exported for tests of the mock itself. */
export const __mock = { sampleBlueprintInput, seededUuid };
