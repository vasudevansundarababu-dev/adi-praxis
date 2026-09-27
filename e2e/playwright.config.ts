import { defineConfig } from '@playwright/test';

/**
 * UI smoke tests against isolated servers (ports 4300/3300/3301, database praxis_e2e) so a running `pnpm dev` is
 * never disturbed. Locally uses the installed Chrome; CI can set PW_CHANNEL= to use Playwright's Chromium.
 */
const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://praxis:praxis@localhost:5442/praxis_e2e';
const REDIS = process.env.E2E_REDIS_URL ?? 'redis://localhost:6389/7';
const env = { NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' };

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    channel: process.env.PW_CHANNEL === undefined ? 'chrome' : process.env.PW_CHANNEL || undefined,
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @praxis/api exec tsx src/server.ts',
      url: 'http://localhost:4300/healthz',
      env: { ...env, DATABASE_URL: E2E_DB, REDIS_URL: REDIS, API_PORT: '4300', CANDIDATE_APP_URL: 'http://localhost:3301', CORS_ORIGINS: 'http://localhost:3300,http://localhost:3301', LOGIN_RATE_LIMIT_PER_MINUTE: '1000' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @praxis/web exec next dev -p 3300',
      url: 'http://localhost:3300/login',
      env: { ...env, API_BASE_URL: 'http://localhost:4300', NEXT_DIST_DIR: '.next-e2e' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @praxis/candidate exec next dev -p 3301',
      url: 'http://localhost:3301/sign-in',
      env: { ...env, API_BASE_URL: 'http://localhost:4300', NEXT_DIST_DIR: '.next-e2e' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
