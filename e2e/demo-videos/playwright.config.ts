import { defineConfig } from '@playwright/test';

/**
 * Demo video recorder (docs/user-guide/VIDEOS.md). Not a test suite: one serial story that drives the apps and records
 * each clip. Start the target first (local: e2e/demo-videos/local-stack.sh; test env: e2e/demo-videos/run.sh).
 * Filter clips with --grep, e.g. `--grep "02 "`; later clips need the state earlier clips created.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'story.spec.ts',
  timeout: 30 * 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../out/demo-videos/test-results',
  use: {
    channel: process.env.PW_CHANNEL || undefined, // bundled Chromium: installed Chrome records a shorter frame than the viewport
    headless: true,
    launchOptions: { slowMo: Number(process.env.VIDEO_SLOWMO ?? 120) },
    trace: 'retain-on-failure',
  },
});
