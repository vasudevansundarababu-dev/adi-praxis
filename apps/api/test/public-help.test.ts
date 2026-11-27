import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { publicHelpRoutes } from '../src/routes/public-help';
import { PUBLIC_PAGE_HELP, publicHelpFor } from '../src/support/public-help';

/**
 * D-109 / D-110 (owner, 27 Nov 2026: "D109 yes (for authoring)"): signed-out pages have Help. Static help-pack text for
 * the public pages only; no Support Bot, no model, no project, rule, task or user data.
 */
const all = [...Object.values(PUBLIC_PAGE_HELP.sme), ...Object.values(PUBLIC_PAGE_HELP.console)];
const text = JSON.stringify(PUBLIC_PAGE_HELP);

describe('public page help', () => {
  it('covers every page anyone can open without signing in, and the console change-password page', () => {
    for (const p of ['/', '/sign-in', '/forgot-password', '/set-password/abc123', '/opportunities', '/opportunities/4f0c', '/privacy', '/terms', '/sign-in?returnTo=%2Fhome', '/terms/'])
      expect(publicHelpFor('sme', p), p).not.toBeNull();
    expect(publicHelpFor('console', '/login')!.title).toBe('Sign in to Authoring');
    expect(publicHelpFor('console', '/change-password')!.title).toBe('Change password');
  });

  it('Tutorials has public help only while TUTORIALS_ENABLED is on (owner, 27 Nov 2026)', () => {
    vi.stubEnv('TUTORIALS_ENABLED', '');
    expect(publicHelpFor('sme', '/tutorials')).toBeNull();
    vi.stubEnv('TUTORIALS_ENABLED', 'true');
    expect(publicHelpFor('sme', '/tutorials')!.title).toBe('Tutorials');
    vi.unstubAllEnvs();
  });

  it('returns nothing for any signed-in page, so no internal page help leaks', () => {
    for (const p of ['/home', '/welcome', '/tasks/t1', '/reviews/r1', '/payments', '/verify', '/run-reviews', '/opportunities/a/b', '/set-password'])
      expect(publicHelpFor('sme', p), p).toBeNull();
    for (const p of ['/', '/projects', '/projects/x/policy', '/users', '/templates', '/review/tasks', '/sign-in'])
      expect(publicHelpFor('console', p), p).toBeNull();
  });

  it('every term has a meaning and an example, and every page says what to do if stuck', () => {
    for (const h of all) {
      expect(h.terms.length, h.title).toBeGreaterThan(1);
      expect(h.stuck.length, h.title).toBeGreaterThan(20);
      for (const x of h.terms) {
        expect(x.meaning.length, x.term).toBeGreaterThan(10);
        expect(x.example.length, x.term).toBeGreaterThan(3);
      }
    }
  });

  it('is plain business English with no internal names or system words', () => {
    expect(text).not.toMatch(/Praxis|Anvil|ADI-Labs|ADI Labs|praxis\.|anvil\./);
    expect(text).not.toMatch(/\b(API|schema|JSON|enum|payload|endpoint|token|cookie|session id|database|worker|queue|model)\b/i);
    expect(text).not.toMatch(/@adi-labs/);
  });
});

describe('GET /help/public', () => {
  async function app() {
    const a = Fastify().withTypeProvider<ZodTypeProvider>();
    a.setValidatorCompiler(validatorCompiler);
    a.setSerializerCompiler(serializerCompiler);
    await a.register(publicHelpRoutes);
    return a;
  }

  it('serves the static help for a public page, cacheable', async () => {
    const a = await app();
    const r = await a.inject({ method: 'GET', url: '/help/public?app=sme&path=%2Fsign-in' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=300');
    expect(r.json().title).toBe('Sign in');
    expect(r.json().terms.map((x: { term: string }) => x.term)).toContain('Forgot password?');
  });

  it('answers 404 for a signed-in page and 400 for a bad query', async () => {
    const a = await app();
    expect((await a.inject({ method: 'GET', url: '/help/public?app=console&path=%2Fprojects' })).statusCode).toBe(404);
    expect((await a.inject({ method: 'GET', url: '/help/public?app=other&path=%2F' })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/help/public?app=sme' })).statusCode).toBe(400);
  });
});
