import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Deployment environment. Staging runs production builds with Stripe test mode, so live identity is required only in production. */
  APP_ENV: z.enum(['local', 'staging', 'production']).optional(),
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
});

export type Config = z.infer<typeof Env> & {
  /** Derived: real Google when a client id is set, otherwise the dev mock. */
  candidateAuthMode: 'google' | 'mock';
  /** Derived: real Stripe when keys are set, otherwise the dev mock. */
  identityMode: 'stripe' | 'mock';
  /** Only live-mode identity results confer eligibility (FLOW2 CF-05). True in production, not in staging. */
  requireLiveIdentity: boolean;
  appEnv: 'local' | 'staging' | 'production';
  /** Derived: Claude on Vertex when a project is set, otherwise the local heuristic mock. */
  assistantMode: 'vertex' | 'mock';
  /** Derived: SMTP when a host is set, otherwise an in-memory outbox. */
  emailMode: 'smtp' | 'memory';
};

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
  if (c.RL_GYM_WEBHOOK_URL && c.RL_GYM_WEBHOOK_SECRET.length < 32) throw new Error('Invalid configuration: RL_GYM_WEBHOOK_SECRET must be at least 32 characters when RL_GYM_WEBHOOK_URL is set');
  if (c.NODE_ENV === 'production' && (candidateAuthMode === 'mock' || identityMode === 'mock' || assistantMode === 'mock' || emailMode === 'memory')) {
    throw new Error('Invalid configuration: production needs GOOGLE_OAUTH_CLIENT_ID, STRIPE_SECRET_KEY, STRIPE_IDENTITY_WEBHOOK_SECRET, VERTEX_PROJECT_ID and SMTP_HOST (mocks are local-only)');
  }
  const appEnv = c.APP_ENV ?? (c.NODE_ENV === 'production' ? 'production' : 'local');
  return { ...c, candidateAuthMode, identityMode, assistantMode, emailMode, appEnv, requireLiveIdentity: appEnv === 'production' };
}
