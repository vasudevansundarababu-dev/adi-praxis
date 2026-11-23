import { z } from 'zod';

const flag = z.enum(['true', 'false', '1', '0', '']).default('false').transform((v) => v === 'true' || v === '1');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Deployment environment. Staging runs production builds with Stripe test mode, so live identity is required only
   * in production. `demo` is a click-through environment: production builds with the local mocks (simulated Google
   * sign-in, identity, AI and email), synthetic data only, never real candidates.
   */
  APP_ENV: z.enum(['local', 'staging', 'production', 'demo']).optional(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(4000),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  /** Candidate app origin, used for apply links and identity return URLs. */
  CANDIDATE_APP_URL: z.string().url().default('http://localhost:3101'),
  CANDIDATE_SESSION_TTL_HOURS: z.coerce.number().positive().default(24),
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_IDENTITY_WEBHOOK_SECRET: z.string().default(''),
  /** Secret for the local-dev mocks (Google credentials, identity webhooks). Never used in production. */
  MOCK_SECRET: z.string().default('local-dev-mock-secret-not-for-production'),
  /** Claude for the SME profile assistant via Vertex AI (decided 26 Sep 2026). Blank = local mock assistant. */
  VERTEX_PROJECT_ID: z.string().default(''),
  VERTEX_LOCATION: z.string().default('global'),
  /** Private evidence bucket; GCS_EMULATOR_HOST points at fake-gcs-server locally. */
  EVIDENCE_BUCKET: z.string().default('praxis-evidence'),
  GCS_EMULATOR_HOST: z.string().default(''),
  GCS_PROJECT_ID: z.string().default('praxis-local'),
  /** Invite email. Mailpit locally; blank = in-memory (tests). The production provider is still open (SPEC). */
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  EMAIL_FROM: z.string().default('ADI Labs Forge Authoring <no-reply@praxis.local>'),
  /** Near-duplicate detection embeddings on Vertex AI (same project as Claude). Blank project = local hashing mock. */
  EMBEDDING_LOCATION: z.string().default('us-central1'),
  EMBEDDING_MODEL: z.string().default('text-embedding-005'),
  /** Nightly hash-chain verification in the worker (UTC cron). "off" when Cloud Scheduler runs it as a Cloud Run job. */
  DATASET_VERIFY_CRON: z.string().default('0 3 * * *'),
  /** FLOW 4 results to RL Gym by signed webhook. Blank URL = RL Gym pulls results instead. */
  RL_GYM_WEBHOOK_URL: z.string().default(''),
  RL_GYM_WEBHOOK_SECRET: z.string().default(''),
  /** M10 SME supply (docs/SME-SUPPLY.md). Off by default: with it off no M10 route, job or menu item exists. */
  SME_SUPPLY_ENABLED: z.enum(['true', 'false', '1', '0', '']).default('false').transform((v) => v === 'true' || v === '1'),
  /** 32-byte key (base64) for secrets M10 must read back: partner webhook signing secrets, test answer keys. */
  M10_ENCRYPTION_KEY: z.string().default(''),
  PARTNER_API_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  /** M10b models on Vertex: CERT_MODEL for knowledge, courses, blueprints, families and grading; CERT_BULK_MODEL for
   *  per-candidate question wording and the independent solver check. Blank bulk model = CERT_MODEL. */
  CERT_MODEL: z.string().default('claude-opus-5'),
  CERT_BULK_MODEL: z.string().default(''),
  /**
   * Support Bot model on Vertex (docs/SUPPORT-BOT.md), same forms as AUTHORING_MODEL (`gemini:<model>` or a Claude id).
   * Empty: follows a Gemini AUTHORING_MODEL (QA), otherwise claude-sonnet-5. Used only with VERTEX_PROJECT_ID set.
   */
  SUPPORT_MODEL: z.string().default(''),
  /** Authoring v2.1: the chatbot facilitator's model on Vertex (live in QA), and its per-client daily call cap. */
  AUTHORING_MODEL: z.string().default('claude-sonnet-5-5'),
  /** FLOW2 suitability assessment model on Vertex: a Claude model id (default), or `gemini:<model>` (QA without Claude quota). */
  SUITABILITY_MODEL: z.string().default('claude-opus-5'),
  /**
   * FLOW2 SME profile assistant model on Vertex: `gemini:<model>`, `claude:<model>` or a Claude id. Empty follows a
   * Gemini AUTHORING_MODEL (QA without Claude quota), otherwise claude-opus-5.
   */
  PROFILE_MODEL: z.string().default(''),
  /**
   * Policy rules page (PRD 5.6): model that suggests rules for a PM's criteria and drafts rule definitions. Same forms as
   * PROFILE_MODEL. Empty follows a Gemini AUTHORING_MODEL (QA), otherwise claude-sonnet-5-5. Suggests only; never decides.
   */
  POLICY_AI_MODEL: z.string().default(''),
  /** Per-client daily cap on policy AI calls (suggestion runs + definitions). */
  POLICY_AI_DAILY_CALL_CAP: z.coerce.number().int().min(1).max(100_000).default(1000),
  /**
   * Praxis-Anvil contract (12 Nov 2026): Anvil's project-scoped dataset-export API, e.g.
   * https://anvil-qa.adi-labs.ai/api/v1/projects/<project>/dataset-exports/generic (one Anvil project per environment). Blank = not connected (Praxis pre-check).
   * The token is an Anvil-issued export-client secret: server only, never logged, never sent to a browser.
   */
  ANVIL_EXPORT_BASE_URL: z.string().regex(/^$|^https:\/\/[^\s]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s]*$/, 'ANVIL_EXPORT_BASE_URL must be https (or http on localhost)').default(''),
  /** Audience of Praxis's identity token when calling Anvil. Blank = the origin of ANVIL_EXPORT_BASE_URL. */
  ANVIL_OUTBOUND_AUDIENCE: z.string().default(''),
  /**
   * New RL Gym (AUTHORING-LOCAL-SETUP 4.3): its API address, workspace slug and its key for Authoring (server only, never
   * logged or sent to a browser). Any of the three blank = not connected: the project page says so and Export is off.
   */
  RLGYM_API_URL: z.string().regex(/^$|^https:\/\/[^\s]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/, 'RLGYM_API_URL must be https (or http on localhost)').default(''),
  RLGYM_WORKSPACE: z.string().regex(/^$|^[a-z0-9][a-z0-9-]{0,62}$/, 'RLGYM_WORKSPACE must be the RL Gym workspace slug').default(''),
  RLGYM_FORGE_CLIENT_KEY: z.string().default(''),
  /** Studio's API (next-version inbox for SME needs) and Authoring's key for it. Either blank = Studio not connected. */
  STUDIO_API_URL: z.string().regex(/^$|^https:\/\/[^\s]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/, 'STUDIO_API_URL must be https (or http on localhost)').default(''),
  STUDIO_INBOX_KEY: z.string().default(''),
  /** Local Studio only: it trusts service headers. Tenant and actor UUIDs of a Studio service principal. */
  STUDIO_TENANT_ID: z.string().default(''),
  STUDIO_ACTOR_ID: z.string().default(''),
  STUDIO_ACTOR_ROLES: z.string().default('service'),
  /** E-001: the data family Validate checks against (Studio resolves its newest qualified environment version). Empty: Validate is not connected. */
  STUDIO_SEED_FAMILY: z.string().default(''),
  /** D-024: the old in-Authoring template editor and builder. Off: templates are read-only (Studio releases only). */
  TEMPLATE_EDITING_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * Keyless Anvil -> Praxis (K6, 12 Nov 2026): Anvil sends a raw Google-signed identity token. It is accepted only with
   * issuer https://accounts.google.com, exactly this audience (this API's URL), this numeric subject and this account.
   * Any of the three blank = keyless inbound is off.
   */
  ANVIL_INBOUND_AUDIENCE: z.string().default(''),
  ANVIL_CALLER_SERVICE_ACCOUNT: z.string().regex(/^$|^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/, 'ANVIL_CALLER_SERVICE_ACCOUNT must be a Google service account').default(''),
  ANVIL_CALLER_SUBJECT: z.string().regex(/^$|^\d{10,30}$/, 'ANVIL_CALLER_SUBJECT must be the numeric Google subject').default(''),
  /**
   * Anvil environment this Praxis environment is bound to (Anvil's four confirmations, point 4): a revocation event is
   * accepted only for this environment and the project in ANVIL_EXPORT_BASE_URL. Blank = revocations are refused.
   */
  ANVIL_ENVIRONMENT: z.enum(['', 'qa', 'staging', 'local']).default(''),
  /**
   * Owner, 11 Nov 2026 (Anvil Q7): no ANVIL key outlives this instant (the pilot's testing-window end, ISO 8601 UTC).
   * Blank = Anvil keys cannot be issued.
   */
  ANVIL_CREDENTIAL_NOT_AFTER: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'ANVIL_CREDENTIAL_NOT_AFTER must be an ISO 8601 UTC time').default(''),
  AUTHORING_DAILY_CALL_CAP: z.coerce.number().int().min(1).max(100_000).default(300),
  /** Wave 3: Vertex location for AUTHORING_MODEL=maas:<publisher>/<model> (the region on the model card, or `global`). Blank = VERTEX_LOCATION. */
  AUTHORING_MAAS_LOCATION: z.string().regex(/^$|^[a-z0-9-]+$/).default(''),
  /** M10c payouts through Trolley. Blank keys = the local mock (refused in production with SME supply on). */
  TROLLEY_ACCESS_KEY: z.string().default(''),
  TROLLEY_SECRET_KEY: z.string().default(''),
  TROLLEY_WEBHOOK_SECRET: z.string().default(''),
  TROLLEY_API_URL: z.string().default('https://api.trolley.com'),
  TROLLEY_WIDGET_URL: z.string().default('https://widget.trolley.com'),
  /** Pay-run total (in USD-equivalent units of the run's currency) above which a second Finance approver is needed.
   *  Blank = one approver (flagged in the audit log as single-approver). */
  PAYRUN_SECOND_APPROVAL_ABOVE: z.string().default(''),
  /** Templates Meta-Compiler (architecture section 10). Comma-separated `provider:model` pairs offered on Screen 3. */
  META_COMPILER_MODELS: z.string().default('claude:claude-sonnet-5,gemini:gemini-3-pro'),
  /** Per-run and per-client daily caps in USD. Blank = live generation refused (D5a, NFR-09). */
  GENERATION_COST_CAP_USD: z.string().default(''),
  GENERATION_DAILY_BUDGET_USD: z.string().default(''),
  /** Live drafters (Claude/Gemini on Vertex) for the Meta-Compiler. Off = the deterministic mock. */
  META_COMPILER_LIVE_AI: flag,
  /** D5 FULL_CODE generation (Phase C). */
  META_COMPILER_CODEGEN_ENABLED: flag,
  /** D5a: allow tasks that use real public data. Off = every task is SYNTHETIC. */
  REAL_DATA_ENABLED: flag,
  /**
   * Rubric editor and recommendations, the S4 policy picker and the SME form wording (docs/plan/PLAN-RUBRIC-
   * RECOMMENDATIONS.md). Off by default: with it off the rubric routes return 404 and the task form is as before.
   */
  RUBRIC_RECOMMENDATIONS_ENABLED: flag,
  /** Model wording for rubric recommendations (needs RUBRIC_RECOMMENDATIONS_ENABLED). Off = rules only, no paid call. */
  RUBRIC_AI_ENABLED: flag,
  /** Model for rubric wording on Vertex (`gemini:<model>` or a Claude id). Empty = follows AUTHORING_MODEL. */
  RUBRIC_AI_MODEL: z.string().default(''),
  /**
   * Suggested text for every field of the SME task form, per-field provenance and per-section confirmation (owner,
   * 15 Nov 2026; docs/design/SUGGESTED-TEXT-AND-RUBRIC-TABLE.md). Off by default. Mock suggestions without Vertex.
   */
  FIELD_SUGGESTIONS_ENABLED: flag,
  /** Model for field suggestions on Vertex (`gemini:<model>` or a Claude id). Empty = the SME profile chat's model. */
  FIELD_SUGGESTIONS_MODEL: z.string().default(''),
  /** Harbor verification runner: mock (tests, local), docker (manual local runs), job (Cloud Run sandbox job). */
  HARBOR_RUNNER: z.enum(['mock', 'docker', 'job']).optional(),
  HARBOR_VERIFY_JOB: z.string().default(''),
  HARBOR_VERIFY_REGION: z.string().default('us-central1'),
  /** Policy Rules extraction (docs/architecture/ARCH-POLICY-RULES.md section 10). Off = providers report Not available. */
  POLICY_EXTRACTION_LIVE: flag,
  LLAMAEXTRACT_API_KEY: z.string().default(''),
  LLAMAEXTRACT_PROJECT_ID: z.string().default(''),
  LLAMAEXTRACT_BASE_URL: z.string().default('https://api.cloud.llamaindex.ai'),
  /** projects/<p>/locations/us/processors/<id> of the Document AI Layout Parser. */
  DOCUMENTAI_PROCESSOR: z.string().default(''),
  DOCUMENTAI_LOCATION: z.string().default('us'),
  POLICY_GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  POLICY_GEMINI_LOCATION: z.string().default('us-central1'),
  /** Cumulative spend ceilings per provider in USD (owner D-B1). Blank = live calls refused. */
  POLICY_BUDGET_LLAMA_USD: z.string().default(''),
  POLICY_BUDGET_GOOGLE_USD: z.string().default(''),
  /** Worst-case estimates used to reserve budget before a job (actual usage recorded after). */
  POLICY_PRICE_LLAMA_USD_PER_PAGE: z.string().default('0.10'),
  POLICY_PRICE_GOOGLE_USD_PER_PAGE: z.string().default('0.03'),
  POLICY_MAX_PAGES: z.coerce.number().int().min(1).max(500).default(20),
  /**
   * D2 tutorial videos (docs/plan/PLAN-D2-TUTORIAL-VIDEO.md). Live = real Gemini, Veo and Text-to-Speech calls on
   * Vertex; off = the deterministic mock pipeline. Never in tests. Blank caps (USD) = live generation is refused.
   */
  TUTORIAL_VIDEO_LIVE: flag,
  TUTORIAL_VIDEO_COST_CAP_USD: z.string().default(''),
  TUTORIAL_VIDEO_DAILY_CAP_USD: z.string().default(''),
  TUTORIAL_VEO_MODEL: z.string().regex(/^veo-[a-z0-9.-]+$/).default('veo-3.1-fast-generate-001'),
  TUTORIAL_VEO_LOCATION: z.string().regex(/^[a-z0-9-]+$/).default('us-central1'),
  /** Veo price per output second, video only, at 720p (Vertex pricing, Nov 2026). */
  TUTORIAL_VEO_PRICE_USD_PER_SECOND: z.string().default('0.08'),
  /** Allowance per chapter for the script (Gemini) and narration (Text-to-Speech) calls; deliberately high. */
  TUTORIAL_TEXT_PRICE_USD_PER_CHAPTER: z.string().default('0.05'),
  /** Script model: `gemini:<model>`. Empty follows a Gemini AUTHORING_MODEL, otherwise gemini:gemini-2.5-flash. */
  TUTORIAL_SCRIPT_MODEL: z.string().default(''),
  TUTORIAL_TTS_VOICE: z.string().regex(/^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9-]+$/).default('en-US-Chirp3-HD-Achernar'),
  /** Private bucket for generated tutorial videos. Blank = EVIDENCE_BUCKET (local only; refused when live). */
  TUTORIAL_BUCKET: z.string().default(''),
});

export type Config = z.infer<typeof Env> & {
  /** Derived: real Google when a client id is set, otherwise the dev mock. */
  candidateAuthMode: 'google' | 'mock';
  /** Derived: real Stripe when keys are set, otherwise the dev mock. */
  identityMode: 'stripe' | 'mock';
  /** Derived: Trolley when its keys are set, otherwise the local payout mock. */
  payoutMode: 'trolley' | 'mock';
  /** Only live-mode identity results confer eligibility (FLOW2 CF-05). True in production, not in staging. */
  requireLiveIdentity: boolean;
  appEnv: 'local' | 'staging' | 'production' | 'demo';
  /** Derived: Claude on Vertex when a project is set, otherwise the local heuristic mock. */
  assistantMode: 'vertex' | 'mock';
  /** Derived: SMTP when a host is set, otherwise an in-memory outbox. */
  emailMode: 'smtp' | 'memory';
  /** Derived Meta-Compiler settings (architecture section 10). */
  metaCompiler: {
    models: { provider: 'claude' | 'gemini'; model: string }[];
    liveAi: boolean;
    costCapUsd: number | null;
    dailyBudgetUsd: number | null;
    codegenEnabled: boolean;
    realDataEnabled: boolean;
    runner: 'mock' | 'docker' | 'job';
    verifyJob: string;
  };
  /** Derived Policy Rules extraction settings (ARCH-POLICY-RULES section 10). */
  policy: PolicyConfig;
  /** Derived D2 tutorial video settings. */
  tutorial: TutorialConfig;
};

export interface TutorialConfig {
  live: boolean;
  /** Publish starts a run only in staging and production; QA (demo), local and tests never generate on publish. */
  onPublish: boolean;
  costCapUsd: number | null;
  dailyCapUsd: number | null;
  veoModel: string;
  veoLocation: string;
  veoPricePerSecond: number;
  textPricePerChapter: number;
  scriptModel: string;
  ttsVoice: string;
  bucket: string;
}

export interface PolicyConfig {
  live: boolean;
  maxPages: number;
  budgets: { llamaextract: number | null; google: number | null };
  prices: { llamaextract: number; google: number };
  llamaextract: { apiKey: string; projectId: string; baseUrl: string };
  google: { processor: string; location: string; geminiModel: string; geminiLocation: string; projectId: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  const candidateAuthMode = c.GOOGLE_OAUTH_CLIENT_ID ? 'google' : 'mock';
  const identityMode = c.STRIPE_SECRET_KEY && c.STRIPE_IDENTITY_WEBHOOK_SECRET ? 'stripe' : 'mock';
  const assistantMode = c.VERTEX_PROJECT_ID ? 'vertex' : 'mock';
  const emailMode = c.SMTP_HOST ? 'smtp' : 'memory';
  const payoutMode = c.TROLLEY_ACCESS_KEY && c.TROLLEY_SECRET_KEY && c.TROLLEY_WEBHOOK_SECRET ? 'trolley' : 'mock';
  if (c.SME_SUPPLY_ENABLED && c.NODE_ENV === 'production' && c.APP_ENV !== 'demo' && payoutMode === 'mock') {
    throw new Error('Invalid configuration: SME_SUPPLY_ENABLED in production needs TROLLEY_ACCESS_KEY, TROLLEY_SECRET_KEY and TROLLEY_WEBHOOK_SECRET (the payout mock is refused)');
  }
  if (c.SME_SUPPLY_ENABLED && c.NODE_ENV === 'production' && c.APP_ENV !== 'demo' && Buffer.from(c.M10_ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new Error('Invalid configuration: SME_SUPPLY_ENABLED needs M10_ENCRYPTION_KEY (32 bytes, base64)');
  }
  if (c.RL_GYM_WEBHOOK_URL && c.RL_GYM_WEBHOOK_SECRET.length < 32) throw new Error('Invalid configuration: RL_GYM_WEBHOOK_SECRET must be at least 32 characters when RL_GYM_WEBHOOK_URL is set');
  if (c.APP_ENV === 'demo' && (c.MOCK_SECRET === 'local-dev-mock-secret-not-for-production' || c.MOCK_SECRET.length < 32)) {
    throw new Error('Invalid configuration: a demo environment needs its own MOCK_SECRET (32+ characters)');
  }
  if (c.NODE_ENV === 'production' && c.APP_ENV !== 'demo' && (candidateAuthMode === 'mock' || identityMode === 'mock' || assistantMode === 'mock' || emailMode === 'memory')) {
    throw new Error('Invalid configuration: production needs GOOGLE_OAUTH_CLIENT_ID, STRIPE_SECRET_KEY, STRIPE_IDENTITY_WEBHOOK_SECRET, VERTEX_PROJECT_ID and SMTP_HOST (mocks are local-only)');
  }
  if (c.AUTHORING_MODEL.startsWith('maas:') && !/^maas:[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(c.AUTHORING_MODEL)) {
    throw new Error('Invalid configuration: AUTHORING_MODEL=maas:<publisher>/<model> needs the exact Model Garden id, e.g. maas:openai/gpt-oss-120b-maas');
  }
  const appEnv = c.APP_ENV ?? (c.NODE_ENV === 'production' ? 'production' : 'local');
  const metaCompiler = metaCompilerConfig(c, appEnv);
  const policy = policyConfig(c, appEnv);
  const tutorial = tutorialConfig(c, appEnv);
  return { ...c, candidateAuthMode, identityMode, assistantMode, emailMode, payoutMode, appEnv, requireLiveIdentity: appEnv === 'production', metaCompiler, policy, tutorial };
}

/** D2: live tutorial generation needs Vertex, both caps and its own bucket, and is never allowed in tests or locally. */
function tutorialConfig(c: z.infer<typeof Env>, appEnv: Config['appEnv']): TutorialConfig {
  const costCapUsd = usdOrNull('TUTORIAL_VIDEO_COST_CAP_USD', c.TUTORIAL_VIDEO_COST_CAP_USD);
  const dailyCapUsd = usdOrNull('TUTORIAL_VIDEO_DAILY_CAP_USD', c.TUTORIAL_VIDEO_DAILY_CAP_USD);
  const veoPricePerSecond = usdOrNull('TUTORIAL_VEO_PRICE_USD_PER_SECOND', c.TUTORIAL_VEO_PRICE_USD_PER_SECOND) ?? 0.08;
  const textPricePerChapter = usdOrNull('TUTORIAL_TEXT_PRICE_USD_PER_CHAPTER', c.TUTORIAL_TEXT_PRICE_USD_PER_CHAPTER) ?? 0.05;
  const authoring = c.AUTHORING_MODEL.startsWith('gemini:') ? c.AUTHORING_MODEL : '';
  const scriptModel = c.TUTORIAL_SCRIPT_MODEL || authoring || 'gemini:gemini-2.5-flash';
  if (!/^gemini:[A-Za-z0-9._-]+$/.test(scriptModel)) throw new Error('Invalid configuration: TUTORIAL_SCRIPT_MODEL must be gemini:<model>');
  if (c.TUTORIAL_VIDEO_LIVE) {
    if (c.NODE_ENV === 'test' || appEnv === 'local') throw new Error('Invalid configuration: TUTORIAL_VIDEO_LIVE is never allowed in tests or local development (live Veo calls cost money)');
    if (!c.VERTEX_PROJECT_ID) throw new Error('Invalid configuration: TUTORIAL_VIDEO_LIVE needs VERTEX_PROJECT_ID');
    if (costCapUsd === null || dailyCapUsd === null) throw new Error('Invalid configuration: TUTORIAL_VIDEO_LIVE needs TUTORIAL_VIDEO_COST_CAP_USD and TUTORIAL_VIDEO_DAILY_CAP_USD');
    if (!c.TUTORIAL_BUCKET) throw new Error('Invalid configuration: TUTORIAL_VIDEO_LIVE needs TUTORIAL_BUCKET');
  }
  return {
    live: c.TUTORIAL_VIDEO_LIVE,
    onPublish: appEnv === 'staging' || appEnv === 'production',
    costCapUsd,
    dailyCapUsd,
    veoModel: c.TUTORIAL_VEO_MODEL,
    veoLocation: c.TUTORIAL_VEO_LOCATION,
    veoPricePerSecond,
    textPricePerChapter,
    scriptModel: scriptModel.slice('gemini:'.length),
    ttsVoice: c.TUTORIAL_TTS_VOICE,
    bucket: c.TUTORIAL_BUCKET || c.EVIDENCE_BUCKET,
  };
}

/** Live policy extraction only in staging, with both ceilings set (owner D-B1, D-D1; never in tests or production). */
function policyConfig(c: z.infer<typeof Env>, appEnv: Config['appEnv']): Config['policy'] {
  const budgets = { llamaextract: usdOrNull('POLICY_BUDGET_LLAMA_USD', c.POLICY_BUDGET_LLAMA_USD), google: usdOrNull('POLICY_BUDGET_GOOGLE_USD', c.POLICY_BUDGET_GOOGLE_USD) };
  const prices = { llamaextract: usdOrNull('POLICY_PRICE_LLAMA_USD_PER_PAGE', c.POLICY_PRICE_LLAMA_USD_PER_PAGE) ?? 0, google: usdOrNull('POLICY_PRICE_GOOGLE_USD_PER_PAGE', c.POLICY_PRICE_GOOGLE_USD_PER_PAGE) ?? 0 };
  if (c.POLICY_EXTRACTION_LIVE) {
    // Owner decisions: staging (D-D1) and, from 10 Nov 2026, the QA environment (APP_ENV=demo) for the authoring v2.1
    // live sessions. Never in tests, local development or production; always with both spending ceilings set.
    if (!(appEnv === 'staging' || appEnv === 'demo') || c.NODE_ENV === 'test') {
      throw new Error('Invalid configuration: POLICY_EXTRACTION_LIVE is only allowed in staging or QA (APP_ENV=staging or demo), never in tests, local or production');
    }
    if (budgets.llamaextract === null || budgets.google === null) throw new Error('Invalid configuration: POLICY_EXTRACTION_LIVE needs POLICY_BUDGET_LLAMA_USD and POLICY_BUDGET_GOOGLE_USD');
  }
  return {
    live: c.POLICY_EXTRACTION_LIVE,
    maxPages: c.POLICY_MAX_PAGES,
    budgets,
    prices,
    llamaextract: { apiKey: c.LLAMAEXTRACT_API_KEY, projectId: c.LLAMAEXTRACT_PROJECT_ID, baseUrl: c.LLAMAEXTRACT_BASE_URL },
    google: { processor: c.DOCUMENTAI_PROCESSOR, location: c.DOCUMENTAI_LOCATION, geminiModel: c.POLICY_GEMINI_MODEL, geminiLocation: c.POLICY_GEMINI_LOCATION, projectId: c.VERTEX_PROJECT_ID },
  };
}

function usdOrNull(name: string, v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid configuration: ${name} must be a positive number of USD`);
  return n;
}

/** Live paid generation only runs in staging or production, on Vertex, with both caps set (NFR-08a, NFR-09, AD-06). */
function metaCompilerConfig(c: z.infer<typeof Env>, appEnv: Config['appEnv']): Config['metaCompiler'] {
  const models = c.META_COMPILER_MODELS.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const [provider, ...rest] = pair.split(':');
    const model = rest.join(':').trim();
    if ((provider !== 'claude' && provider !== 'gemini') || !model) throw new Error(`Invalid configuration: META_COMPILER_MODELS entry "${pair}" must be claude:<model> or gemini:<model>`);
    return { provider, model } as const;
  });
  const costCapUsd = usdOrNull('GENERATION_COST_CAP_USD', c.GENERATION_COST_CAP_USD);
  const dailyBudgetUsd = usdOrNull('GENERATION_DAILY_BUDGET_USD', c.GENERATION_DAILY_BUDGET_USD);
  const deployed = appEnv === 'staging' || appEnv === 'production';
  if (c.META_COMPILER_LIVE_AI) {
    if (!deployed || c.NODE_ENV === 'test') throw new Error('Invalid configuration: META_COMPILER_LIVE_AI is only allowed in staging or production (live paid calls are never made locally, in demo or in tests)');
    if (!c.VERTEX_PROJECT_ID) throw new Error('Invalid configuration: META_COMPILER_LIVE_AI needs VERTEX_PROJECT_ID');
    if (costCapUsd === null || dailyBudgetUsd === null) throw new Error('Invalid configuration: META_COMPILER_LIVE_AI needs GENERATION_COST_CAP_USD and GENERATION_DAILY_BUDGET_USD');
    if (models.length === 0) throw new Error('Invalid configuration: META_COMPILER_LIVE_AI needs at least one META_COMPILER_MODELS entry');
  }
  if (c.META_COMPILER_CODEGEN_ENABLED && !c.META_COMPILER_LIVE_AI) throw new Error('Invalid configuration: META_COMPILER_CODEGEN_ENABLED needs META_COMPILER_LIVE_AI');
  // Without a sandbox job, staging and production still start, but verification refuses to measure with the mock
  // there (harbor runner), so no studio can be deployed without real 0.00 / 1.00 scores (D-12).
  const runner = c.HARBOR_RUNNER ?? (c.HARBOR_VERIFY_JOB ? 'job' : 'mock');
  if (runner === 'job' && !c.HARBOR_VERIFY_JOB) throw new Error('Invalid configuration: HARBOR_RUNNER=job needs HARBOR_VERIFY_JOB');
  if (runner === 'docker' && deployed) throw new Error('Invalid configuration: HARBOR_RUNNER=docker is for local development only');
  return { models, liveAi: c.META_COMPILER_LIVE_AI, costCapUsd, dailyBudgetUsd, codegenEnabled: c.META_COMPILER_CODEGEN_ENABLED, realDataEnabled: c.REAL_DATA_ENABLED, runner, verifyJob: c.HARBOR_VERIFY_JOB };
}
