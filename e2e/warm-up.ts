import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Global set-up for the local e2e servers: compile every page of the console and the candidate app once, before any
 * test starts.
 *
 * The e2e servers run `next dev`, which compiles a route the first time it is requested. With two workers, one test
 * opening a large page for the first time (the Meta-Compiler editor took 12.7 s on a CI runner) held up the other
 * test's request on the same server, and smaller first compiles (4.5–4.7 s) used up a 5 s expectation on their own.
 * Warming every route here keeps those compile times out of the tests, so their assertions and timeouts stay as they
 * are. Skipped against a deployed environment, whose pages are prebuilt. A warm-up failure is reported but never
 * fails the run: the tests themselves decide.
 */
const ROOT = path.resolve(__dirname, '..');
const APPS = [
  { base: 'http://localhost:3300', dir: path.join(ROOT, 'apps/web/app') },
  { base: 'http://localhost:3301', dir: path.join(ROOT, 'apps/candidate/app') },
];
const DUMMY_ID = '00000000-0000-4000-8000-000000000000';

/** Every page route of a Next.js app directory, with route groups dropped and dynamic segments filled in. */
export function pageRoutes(dir: string, prefix: string[] = []): string[] {
  const routes: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith('_') || name.startsWith('@')) continue; // private folders and parallel-route slots
      const segment = /^\(.*\)$/.test(name) ? null : /^\[.*\]$/.test(name) ? DUMMY_ID : name;
      routes.push(...pageRoutes(full, segment ? [...prefix, segment] : prefix));
    } else if (/^page\.(tsx|ts|jsx|js)$/.test(name)) {
      routes.push(`/${prefix.join('/')}`);
    }
  }
  return routes;
}

async function warm(base: string, routes: string[]) {
  for (const route of routes) {
    const started = Date.now();
    try {
      // The page compiles before its layout checks the session, so an anonymous request is enough.
      const res = await fetch(`${base}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(180_000) });
      await res.arrayBuffer();
      if (res.status >= 500) console.warn(`[warm-up] ${base}${route} answered ${res.status}`);
    } catch (err) {
      console.warn(`[warm-up] ${base}${route} failed: ${(err as Error).message}`);
    }
    const ms = Date.now() - started;
    if (ms > 3_000) console.log(`[warm-up] ${base}${route} compiled in ${(ms / 1000).toFixed(1)} s`);
  }
}

export default async function globalSetup() {
  if (process.env.E2E_WEB_URL) return;
  const started = Date.now();
  // The same-origin API proxy is a route handler; warm it with one harmless call per app.
  await Promise.all(
    APPS.map(async ({ base, dir }) => {
      await warm(base, ['/api/v1/healthz']);
      await warm(base, [...new Set(pageRoutes(dir))].sort());
    }),
  );
  console.log(`[warm-up] compiled the e2e pages in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
