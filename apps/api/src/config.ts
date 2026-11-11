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
  EMAIL_FROM: z.string().default('ADI Praxis <no-reply@praxis.local>'),
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
  /** Support Bot model on Vertex (docs/SUPPORT-BOT.md). Used only when VERTEX_PROJECT_ID is set; otherwise a local mock. */
  SUPPORT_MODEL: z.string().default('claude-sonnet-5'),
  /** Authoring v2.1: the chatbot facilitator's model on Vertex (live in QA), and its per-client daily call cap. */
  AUTHORING_MODEL: z.string().default('claude-sonnet-5-5'),
  AUTHORING_DAILY_CALL_CAP: z.coerce.number().int().min(1).max(100_000).default(300),
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
};

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
  const appEnv = c.APP_ENV ?? (c.NODE_ENV === 'production' ? 'production' : 'local');
  const metaCompiler = metaCompilerConfig(c, appEnv);
  const policy = policyConfig(c, appEnv);
  return { ...c, candidateAuthMode, identityMode, assistantMode, emailMode, payoutMode, appEnv, requireLiveIdentity: appEnv === 'production', metaCompiler, policy };
}

/** Live policy extraction only in staging, with both ceilings set (owner D-B1, D-D1; never in tests or production). */
function policyConfig(c: z.infer<typeof Env>, appEnv: Config['appEnv']): Config['policy'] {
  const budgets = { llamaextract: usdOrNull('POLICY_BUDGET_LLAMA_USD', c.POLICY_BUDGET_LLAMA_USD), google: usdOrNull('POLICY_BUDGET_GOOGLE_USD', c.POLICY_BUDGET_GOOGLE_USD) };
  const prices = { llamaextract: usdOrNull('POLICY_PRICE_LLAMA_USD_PER_PAGE', c.POLICY_PRICE_LLAMA_USD_PER_PAGE) ?? 0, google: usdOrNull('POLICY_PRICE_GOOGLE_USD_PER_PAGE', c.POLICY_PRICE_GOOGLE_USD_PER_PAGE) ?? 0 };
  if (c.POLICY_EXTRACTION_LIVE) {
    if (appEnv !== 'staging' || c.NODE_ENV === 'test') throw new Error('Invalid configuration: POLICY_EXTRACTION_LIVE is only allowed in staging');
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
