import {
  CommitStudioTaskRequest,
  HarborBlueprint,
  SaveStudioDraftRequest,
  STUDIO_STEP_IDS,
  type SmeAuthoredTaskDto,
  type StudioAnswers,
} from '@praxis/shared';
import type { StudioConfig } from './types';
import { studioAnswerProblems, taskJsonPreview, TITLE_KEY } from './steps';

/**
 * Typed stand-in for the Stream 2 studio routes (`/candidate/studio/:studioKey[...]`, architecture §5 and §7), used
 * while STUDIO_API_MODE is `mock`. Any well-formed studio key opens a synthetic studio; a key containing `stopped`
 * is a stopped deployment. Delete this file when the real routes land.
 */

export interface StudioMockContext {
  /** Signed-in SME (from GET /me); null means unauthenticated. */
  smeUserId: string | null;
  now?: () => number;
}

export interface StudioMockResult {
  status: number;
  body: unknown;
}

interface Task {
  taskInstanceId: string;
  revision: number;
  answers: StudioAnswers | null;
}
interface Studio {
  task: Task;
  committed: Array<{ dto: SmeAuthoredTaskDto; taskJson: unknown }>;
  replies: Map<string, StudioMockResult>;
}

const KEY = '__praxisStudioMockStore';
function store(): Map<string, Studio> {
  const g = globalThis as unknown as Record<string, Map<string, Studio> | undefined>;
  return (g[KEY] ??= new Map());
}
export function resetStudioMock() {
  delete (globalThis as unknown as Record<string, unknown>)[KEY];
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
function seededUuid(seed: string): string {
  const h = [0, 1, 2, 3].map((i) => hash(`${seed}:${i}`)).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const STUDIO_KEY = /^[a-z0-9][a-z0-9_-]{2,119}$/;

/** Synthetic marketing blueprint (Harbor PDF §4.1 example shape; no real data). Agent-facing: no hidden paths. */
export function mockStudioBlueprint(): HarborBlueprint {
  return HarborBlueprint.parse({
    studio_id: 'mktg-noise-cancelling-launch',
    template_meta: { template_id: 'mktg-launch-ncp', label: 'Launch of Noise Cancelling Phone', domain_category: 'Digital Marketing', tpt_minutes: 45, tpt_label: '12 Wks', modes: ['HERMETIC_MCP'] },
    domain_meta: {
      title: 'Launch of Noise Cancelling Phone',
      persona_label: 'Growth Marketing Lead',
      objective: 'Allocate weekly spend across channels without breaching the CAC ceiling.',
      horizon: { type: 'episodic_loop', max_turns: 12, cadence_unit: 'Wks' },
    },
    step_2_data_panels: {
      public_dropzones: [
        { id: 'queries', label: 'Scraped search queries', target_path: '/workspace/inputs/scraped_queries.csv', format: 'csv', description: 'One synthetic query per row.' },
        { id: 'brand_brief', label: 'Brand brief', target_path: '/workspace/inputs/brand_brief.md', format: 'md' },
      ],
      oracle_annotator: {
        dataset_name: 'keyword_intent',
        columns: ['keyword', 'monthly_volume'],
        sme_tag_options: ['BUY', 'RESEARCH', 'IGNORE'],
        template_preview_rows: [
          ['quiet phone deal', '1200'],
          ['best anc phone review', '5400'],
          ['phone case blue', '800'],
        ],
      },
    },
    step_3_mcp_simulators: {
      tools: [{ tool_id: 'advance_campaign_week', parameters: [{ name: 'spend_usd', type: 'number' }] }],
      widgets: [
        { archetype: 'diminishing_returns_curve_slider', key: 'k_half', label: 'Saturation spend (K_half)', min: 1000, max: 50000, default: 12000, step: 500, formula: 'CTR(s) = CTR_base * (s / (s + K_half))' },
        { archetype: 'diminishing_returns_curve_slider', key: 'ctr_base', label: 'Base CTR (CTR_base)', min: 0.01, max: 0.2, default: 0.06, step: 0.01, formula: 'CTR(s) = CTR_base * (s / (s + K_half))' },
        { archetype: 'fuzzy_match_threshold_slider', key: 'match_threshold', label: 'Keyword match threshold', min: 0.5, max: 1, default: 0.85, step: 0.05 },
      ],
    },
    step_4_invariant_catalog: {
      allowed_subjects: ['weekly_cac_usd', 'channels'],
      rules: [
        { id: 'cac_ceiling', subject: 'weekly_cac_usd', operator: 'GREATER_THAN', threshold: 42, description: 'IF weekly CAC > $42 THEN hard fail.' },
        { id: 'no_banned_channels', subject: 'channels', operator: 'CONTAINS_ANY', threshold: ['tabloid_print'], description: 'IF a banned channel is used THEN hard fail.' },
      ],
    },
    step_5_default_rubric: {
      milestones: [
        { id: 'intent_f1', label: 'Keyword intent', weight: 40, verifier_template: 'f1_set_match' },
        { id: 'budget_lp', label: 'Budget allocation', weight: 35, verifier_template: 'lp_solver_ceiling' },
        { id: 'report_schema', label: 'Weekly report schema', weight: 25, verifier_template: 'regex_schema' },
      ],
    },
    custom_fields_by_stage: {
      stage_1: [
        { field_id: 'launch_locales', label: 'Launch locales', input_type: 'multi_select', options: ['en-GB', 'en-US', 'de-DE'], default_value: ['en-GB'], inject_into: ['task.json'] },
        { field_id: 'budget_cap_usd', label: 'Total budget cap (USD)', input_type: 'number_input', min: 1000, max: 500000, default_value: 120000, inject_into: ['instruction.md', 'task.json'] },
      ],
      stage_3: [{ field_id: 'target_cac_ceiling', label: 'Target CAC ceiling', input_type: 'currency_slider', min: 10, max: 100, default_value: 42, inject_into: ['instruction.md'] }],
      stage_4: [{ field_id: 'allow_retargeting', label: 'Allow retargeting', input_type: 'boolean_toggle', default_value: false, inject_into: ['task.json'] }],
      stage_5: [{ field_id: 'report_tone', label: 'Report tone', input_type: 'single_select', options: ['Formal', 'Concise'], default_value: 'Concise', inject_into: ['instruction.md'] }],
    },
  });
}

function studio(key: string): Studio {
  const s = store();
  let st = s.get(key);
  if (!st) {
    st = { task: { taskInstanceId: seededUuid(`task:${key}:0`), revision: 0, answers: null }, committed: [], replies: new Map() };
    s.set(key, st);
  }
  return st;
}

const json = (status: number, body: unknown): StudioMockResult => ({ status, body });
const error = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => json(status, { error: code, message, ...extra });

function config(key: string): StudioConfig {
  const st = studio(key);
  return {
    studioKey: key,
    deploymentStatus: key.includes('stopped') ? 'STOPPED' : 'ACTIVE',
    workflowName: 'Launch of Noise Cancelling Phone',
    templateVersion: 1,
    projectName: 'SYNTHETIC Launch pilot',
    taskInstanceId: st.task.taskInstanceId,
    revision: st.task.revision,
    answers: st.task.answers,
    blueprint: mockStudioBlueprint(),
    realDataEnabled: false,
  };
}

function commit(key: string, body: unknown, ctx: StudioMockContext): StudioMockResult {
  const req = CommitStudioTaskRequest.safeParse(body);
  if (!req.success) return error(400, 'VALIDATION_FAILED', req.error.issues.map((i) => i.message).join('; '));
  const st = studio(key);
  if (req.data.expectedRevision !== st.task.revision) return error(409, 'STALE_REVISION', 'This task changed in another window. Reload to continue.', { revision: st.task.revision });
  const answers = st.task.answers;
  if (!answers) return error(422, 'EMPTY', 'Save your work before committing.');
  const bp = mockStudioBlueprint();
  const problems = studioAnswerProblems(bp, answers);
  if (STUDIO_STEP_IDS.some((s) => problems[s].length)) return error(422, 'STUDIO_INCOMPLETE', 'Some steps need attention before you can commit.', { problems });
  if (req.data.dataClassification === 'REAL_PUBLIC') return error(422, 'REAL_DATA_DISABLED', 'Real public data is not allowed yet: every task is synthetic (D5a).');
  const version = 1;
  const taskJsonText = taskJsonPreview(bp, answers);
  const taskJson = JSON.parse(taskJsonText) as unknown;
  const bundleSha256 = hash(`${st.task.taskInstanceId}:${taskJsonText}`).repeat(8);
  const externalTaskId = `TASK-MKTG-${hash(st.task.taskInstanceId).slice(0, 6).toUpperCase()}`;
  const authoredTaskId = seededUuid(`authored:${st.task.taskInstanceId}`);
  const title = String(answers.fields[TITLE_KEY] ?? '').trim();
  st.committed.unshift({
    taskJson,
    dto: {
      id: authoredTaskId,
      externalTaskId,
      taskInstanceId: st.task.taskInstanceId,
      submissionVersion: version,
      templateId: seededUuid('template:mock'),
      templateVersion: 1,
      workflowName: 'Launch of Noise Cancelling Phone',
      projectId: seededUuid('project:mock'),
      projectName: 'SYNTHETIC Launch pilot',
      authoredBy: null,
      title,
      executionMode: 'HERMETIC_MCP',
      bundleSha256,
      zeroBaselineScore: null,
      oracleScore: null,
      dataClassification: 'SYNTHETIC',
      reviewStatus: 'SUBMITTED',
      createdAt: new Date((ctx.now ?? Date.now)()).toISOString(),
    },
  });
  const n = st.committed.length;
  st.task = { taskInstanceId: seededUuid(`task:${key}:${n}`), revision: 0, answers: null };
  return json(200, { status: 'SUBMITTED', version, authoredTaskId, externalTaskId, bundleSha256, taskJson });
}

/** Mock of the studio routes. `idempotencyKey` replays the stored response for a repeated commit (S4-10). */
export function handleStudioMock(method: string, path: string, body: unknown, ctx: StudioMockContext, idempotencyKey?: string | null): StudioMockResult {
  if (!ctx.smeUserId) return error(401, 'UNAUTHENTICATED', 'Sign in first');
  const m = /^\/candidate\/studio\/([^/]+)(\/draft|\/commit|\/tasks)?$/.exec(path.split('?')[0]!.replace(/\/+$/, ''));
  if (!m || !STUDIO_KEY.test(m[1]!)) return error(404, 'NOT_FOUND', 'Studio not found');
  const key = m[1]!;
  const action = m[2] ?? '';
  const replayKey = idempotencyKey ? `${ctx.smeUserId}:${idempotencyKey}` : null;
  const st = studio(key);
  if (replayKey && st.replies.has(replayKey)) return st.replies.get(replayKey)!;
  const remember = (r: StudioMockResult) => {
    if (replayKey && r.status < 300) st.replies.set(replayKey, r);
    return r;
  };
  const closed = key.includes('stopped');

  if (method === 'GET' && action === '') return json(200, config(key));
  if (method === 'GET' && action === '/tasks') return json(200, { items: st.committed.map((c) => c.dto) });
  if (closed && (action === '/draft' || action === '/commit')) return error(409, 'STUDIO_CLOSED', 'This studio is closed.');
  if (method === 'PUT' && action === '/draft') {
    const req = SaveStudioDraftRequest.safeParse(body);
    if (!req.success) return error(400, 'VALIDATION_FAILED', req.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    if (req.data.expectedRevision !== st.task.revision) return error(409, 'STALE_REVISION', 'This task changed in another window. Reload to continue.', { revision: st.task.revision });
    st.task = { ...st.task, answers: req.data.answers, revision: st.task.revision + 1 };
    return remember(json(200, { revision: st.task.revision, savedAt: new Date((ctx.now ?? Date.now)()).toISOString() }));
  }
  if (method === 'POST' && action === '/commit') return remember(commit(key, body, ctx));
  return error(404, 'NOT_FOUND', `No mock route for ${method} ${path}`);
}
