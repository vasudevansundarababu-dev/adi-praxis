import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
});

export type Config = z.infer<typeof Env> & {
  /** Derived: real Google when a client id is set, otherwise the dev mock. */
  candidateAuthMode: 'google' | 'mock';
  /** Derived: real Stripe when keys are set, otherwise the dev mock. */
  identityMode: 'stripe' | 'mock';
  /** Only live-mode identity results confer eligibility (FLOW2 CF-05). True in production. */
  requireLiveIdentity: boolean;
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
  if (c.NODE_ENV === 'production' && (candidateAuthMode === 'mock' || identityMode === 'mock')) {
    throw new Error('Invalid configuration: production needs GOOGLE_OAUTH_CLIENT_ID, STRIPE_SECRET_KEY and STRIPE_IDENTITY_WEBHOOK_SECRET (mocks are local-only)');
  }
  return { ...c, candidateAuthMode, identityMode, requireLiveIdentity: c.NODE_ENV === 'production' };
}
