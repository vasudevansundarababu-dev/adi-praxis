import { defineConfig } from '@playwright/test';

/**
 * UI smoke tests. Locally they start isolated servers (ports 4300/3300/3301, database praxis_e2e) so a running
 * `pnpm dev` is never disturbed, using the installed Chrome (CI sets PW_CHANNEL= for Playwright's Chromium).
 * Against a deployed environment set E2E_WEB_URL and E2E_CANDIDATE_URL (plus E2E_* credentials): no servers start.
 */
const external = !!process.env.E2E_WEB_URL;
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
  webServer: external
    ? []
    : [
    {
      command: 'pnpm --filter @praxis/api exec tsx src/server.ts',
      url: 'http://localhost:4300/healthz',
      env: { ...env, DATABASE_URL: E2E_DB, REDIS_URL: REDIS, API_PORT: '4300', CANDIDATE_APP_URL: 'http://localhost:3301', CORS_ORIGINS: 'http://localhost:3300,http://localhost:3301', LOGIN_RATE_LIMIT_PER_MINUTE: '1000', SME_SUPPLY_ENABLED: 'true', GCS_EMULATOR_HOST: 'http://localhost:4443', GCS_PROJECT_ID: 'praxis-local', EVIDENCE_BUCKET: 'praxis-evidence' },
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // M10 generation runs and webhooks are worker jobs.
      command: 'pnpm --filter @praxis/api exec tsx src/worker.ts',
      url: 'http://localhost:4301/healthz',
      env: { ...env, DATABASE_URL: E2E_DB, REDIS_URL: REDIS, WORKER_HEALTH_PORT: '4301', CANDIDATE_APP_URL: 'http://localhost:3301', SME_SUPPLY_ENABLED: 'true', DATASET_VERIFY_CRON: 'off' },
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: 'pnpm --filter @praxis/web exec next dev -p 3300',
      url: 'http://localhost:3300/login',
      env: { ...env, API_BASE_URL: 'http://localhost:4300', NEXT_DIST_DIR: '.next-e2e', SME_SUPPLY_ENABLED: 'true' },
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: 'pnpm --filter @praxis/candidate exec next dev -p 3301',
      url: 'http://localhost:3301/sign-in',
      env: { ...env, API_BASE_URL: 'http://localhost:4300', NEXT_DIST_DIR: '.next-e2e', SME_SUPPLY_ENABLED: 'true' },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
