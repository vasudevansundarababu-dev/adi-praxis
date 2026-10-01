import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Helpers for the scripted demo videos (docs/user-guide/VIDEOS.md). Each clip is one browser context recorded by
 * Playwright, with on-screen captions, a visible cursor and click ripples injected into every page. Targets the local
 * demo stack by default; set VIDEO_WEB_URL / VIDEO_CANDIDATE_URL / VIDEO_API_URL and VIDEO_*_PASSWORD for a deployed
 * environment (run.sh reads them from Secret Manager). Data the videos create is named "[Demo video] …".
 */
export const ENV = {
  web: process.env.VIDEO_WEB_URL ?? 'http://localhost:3500',
  candidate: process.env.VIDEO_CANDIDATE_URL ?? 'http://localhost:3501',
  api: process.env.VIDEO_API_URL ?? 'http://localhost:4500',
  local: !process.env.VIDEO_WEB_URL,
};
const pw = (role: string, local: string) => process.env[`VIDEO_${role}_PASSWORD`] ?? local;
export const USERS = {
  admin: { email: 'admin@praxis.demo', password: pw('ADMIN', 'video-admin-password'), name: 'Admin' },
  pm: { email: 'pm@praxis.demo', password: pw('PM', 'video-pm-password'), name: 'Pat Morgan (PM)' },
  validator: { email: 'reviewer@praxis.demo', password: pw('REVIEWER', 'video-reviewer-password'), name: 'Riley Chen (Validator)' },
  finance: { email: 'finance@praxis.demo', password: pw('FINANCE', 'video-finance-password'), name: 'Farah Iqbal (Finance)' },
  partner: { email: 'partner@praxis.demo', password: pw('PARTNER', 'video-partner-password'), name: 'Meera Nair (Partner)' },
};

export const OUT = path.resolve(__dirname, '../..', process.env.VIDEO_OUT ?? 'out/demo-videos');
const RAW = path.join(OUT, 'raw');

export const SIZE = { width: 1440, height: 900 };

/** Shared story state between clips, also written to out/demo-videos/state.json for debugging. */
export const state: Record<string, string> = existsSync(path.join(OUT, 'state.json')) && process.env.VIDEO_FRESH !== '1' ? JSON.parse(readFileSync(path.join(OUT, 'state.json'), 'utf8')) : {};
export const RUN_TAG: string = process.env.VIDEO_RUN_TAG ?? state.runTag ?? new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '');
state.runTag = RUN_TAG;

export function remember(k: string, v: string) {
  state[k] = v;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2));
}

const OVERLAY = `
(() => {
  if (window.__demoOverlay) return; window.__demoOverlay = true;
  const css = document.createElement('style');
  css.textContent = \`
    #demo-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-4px 0 0 -4px;pointer-events:none;transition:left .12s linear,top .12s linear;
      background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'><path d='M2 2l7 18 3-7 7-3z' fill='black' stroke='white' stroke-width='1.5'/></svg>") no-repeat}
    .demo-ripple{position:fixed;z-index:2147483646;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;pointer-events:none;
      border:3px solid #f5a524;animation:demo-ripple .6s ease-out forwards}
    @keyframes demo-ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
    #demo-caption{position:fixed;z-index:2147483645;left:50%;bottom:28px;transform:translateX(-50%);max-width:80%;pointer-events:none;
      background:rgba(15,23,42,.88);color:#fff;font:600 22px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;padding:14px 22px;border-radius:12px;
      box-shadow:0 8px 30px rgba(0,0,0,.35);text-align:center}
    #demo-caption:empty{display:none}
    nextjs-portal{display:none!important}
    #demo-caption small{display:block;font-weight:500;font-size:16px;opacity:.85;margin-top:4px}\`;
  let last = { x: -50, y: -50 };
  const mount = () => {
    if (!document.body || document.getElementById('demo-cursor')) return;
    if (!css.isConnected) document.head.appendChild(css);
    const c = document.createElement('div'); c.id = 'demo-cursor'; c.style.left = last.x + 'px'; c.style.top = last.y + 'px'; document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = 'demo-caption'; document.body.appendChild(cap);
    try { cap.innerHTML = sessionStorage.getItem('demo-caption') || ''; } catch {}
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', mount) : mount();
  // React hydration can drop nodes added to <body>; put them back.
  setInterval(() => { if (!document.getElementById('demo-cursor') || !document.getElementById('demo-caption') || !css.isConnected) { document.getElementById('demo-cursor')?.remove(); document.getElementById('demo-caption')?.remove(); mount(); } }, 300);
  addEventListener('mousemove', (e) => { last = { x: e.clientX, y: e.clientY }; const c = document.getElementById('demo-cursor'); if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; } }, true);
  addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
  window.__demoCaption = (html) => { try { sessionStorage.setItem('demo-caption', html); } catch {} mount(); const cap = document.getElementById('demo-caption'); if (cap) cap.innerHTML = html; };
})();`;

/** Scrolls an element to the middle of the screen so the caption at the bottom never hides it. */
async function center(l: Locator) {
  await l.waitFor({ state: 'visible' });
  await l.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
}

/** A recorded clip: one browser context whose video is saved as raw/<id>.webm when the clip ends. */
export class Clip {
  constructor(readonly id: string, readonly ctx: BrowserContext, readonly page: Page) {}

  static async start(browser: Browser, id: string, opts: { mobile?: boolean } = {}) {
    const size = opts.mobile ? { width: 390, height: 844 } : SIZE;
    const dir = path.join(RAW, id);
    rmSync(dir, { recursive: true, force: true });
    const ctx = await browser.newContext({ viewport: size, recordVideo: { dir, size }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Asia/Kolkata', bypassCSP: true });
    await ctx.addInitScript(OVERLAY);
    const page = await ctx.newPage();
    page.setDefaultTimeout(45_000);
    return new Clip(id, ctx, page);
  }

  /** A full-screen title card shown for a few seconds at the start of a clip. */
  async title(heading: string, sub: string, seconds = 4) {
    await this.page.setContent(`<html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
      background:linear-gradient(135deg,#0b1f3a,#123a6b 60%,#1d6fb8);font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#fff">
      <div style="text-align:center;max-width:1000px;padding:40px">
      <div style="letter-spacing:.2em;font-size:18px;opacity:.8;text-transform:uppercase">ADI Praxis · release 1.1</div>
      <h1 style="font-size:56px;margin:18px 0 14px">${heading}</h1>
      <p style="font-size:24px;line-height:1.5;opacity:.92;margin:0">${sub}</p></div></body></html>`);
    await this.page.waitForTimeout(seconds * 1000);
  }

  /** Shows a caption at the bottom of the screen and holds it long enough to read. */
  async say(text: string, detail = '', hold?: number) {
    const html = detail ? `${text}<small>${detail}</small>` : text;
    await this.page.evaluate((h) => (window as unknown as { __demoCaption?: (s: string) => void }).__demoCaption?.(h), html).catch(() => {});
    const words = (text + ' ' + detail).split(/\s+/).length;
    await this.page.waitForTimeout(hold ?? Math.min(7000, 1400 + words * 260));
  }

  async clear() {
    await this.page.evaluate(() => (window as unknown as { __demoCaption?: (s: string) => void }).__demoCaption?.('')).catch(() => {});
  }

  async pause(ms = 1200) {
    await this.page.waitForTimeout(ms);
  }

  /** Moves the visible cursor onto an element, then clicks it. */
  async click(l: Locator, opts: { hold?: number } = {}) {
    await center(l);
    const b = await l.boundingBox();
    if (b) await this.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await this.page.waitForTimeout(250);
    await l.click();
    await this.page.waitForTimeout(opts.hold ?? 700);
  }

  /** Types visibly (short values) or fills at once (long text), after moving the cursor to the field. */
  async type(l: Locator, value: string) {
    l = l.and(this.page.locator('input, textarea')).first();
    await center(l);
    const b = await l.boundingBox();
    if (b) await this.page.mouse.move(b.x + Math.min(40, b.width / 2), b.y + b.height / 2, { steps: 8 });
    await l.click();
    if (value.length <= 60) {
      await l.fill('');
      await l.pressSequentially(value, { delay: 28 });
    } else {
      await l.fill(value);
    }
    await this.page.waitForTimeout(300);
  }

  /** Scrolls smoothly so viewers can read a long page. */
  async scroll(px = 600, ms = 1200) {
    await this.page.mouse.wheel(0, px);
    await this.page.waitForTimeout(ms);
  }

  async end() {
    await this.clear();
    await this.page.waitForTimeout(600);
    const video = this.page.video();
    await this.ctx.close();
    if (video) {
      const src = await video.path();
      renameSync(src, path.join(RAW, `${this.id}.webm`));
      rmSync(path.join(RAW, this.id), { recursive: true, force: true });
    }
  }
}

export async function staffLogin(c: Clip, who: keyof typeof USERS, opts: { narrate?: boolean } = {}) {
  const u = USERS[who];
  const p = c.page;
  await p.goto(who === 'partner' ? `${ENV.web}/partner/login` : `${ENV.web}/login`);
  await p.waitForLoadState('networkidle');
  if (opts.narrate) await c.say(`Sign in as ${u.name}`, u.email);
  await c.type(p.getByLabel(who === 'partner' ? 'Work email' : 'Email'), u.email);
  await p.getByLabel('Password').fill(u.password);
  await c.click(p.getByRole('button', { name: /^sign in$/i }));
  if (who === 'partner') await expect(p.getByRole('heading', { name: /Welcome/ })).toBeVisible({ timeout: 30_000 });
  else await expect(p.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
}

/** Opens a console menu group, then (optionally) a page on its second row. */
export async function menu(c: Clip, group: string, pageName?: string) {
  const nav = c.page.getByRole('navigation', { name: 'Main' });
  await c.click(nav.getByRole('link', { name: group, exact: true }));
  if (pageName) await c.click(c.page.getByRole('navigation', { name: `${group} pages` }).getByRole('link', { name: pageName, exact: true }));
  await c.page.waitForLoadState('networkidle');
}

/** Candidate sign-in through the simulated Google form (demo and local environments). */
export async function candidateSignIn(c: Clip, email: string, name: string, returnTo = '/home') {
  const p = c.page;
  if (!p.url().includes('/sign-in')) await p.goto(`${ENV.candidate}/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  await p.waitForLoadState('networkidle');
  const age = p.getByRole('checkbox').first();
  if (await age.isVisible()) await c.click(age);
  await c.type(p.locator('#dev-email'), email);
  await c.type(p.locator('#dev-name'), name);
  await c.click(p.getByRole('button', { name: /continue with google \(mock\)/i }));
  await p.waitForLoadState('networkidle');
}

/** A JSON API session for set-up steps that are not part of what the video shows. */
export async function api(ctx: BrowserContext, origin = ENV.api) {
  const base = `${origin}/api/v1/`; // pass the app origin to use a browser session (the apps proxy /api/v1)
  const call = async (method: string, url: string, data?: unknown, headers: Record<string, string> = {}) => {
    const r = await ctx.request.fetch(base + url, { method, data, headers: { 'idempotency-key': crypto.randomUUID(), ...headers } });
    const body = await r.text();
    if (!r.ok()) throw new Error(`${method} ${url}: ${r.status()} ${body.slice(0, 400)}`);
    return body ? JSON.parse(body) : null;
  };
  return { get: (u: string) => call('GET', u), post: (u: string, d?: unknown, h?: Record<string, string>) => call('POST', u, d ?? {}, h), put: (u: string, d?: unknown) => call('PUT', u, d ?? {}), patch: (u: string, d?: unknown) => call('PATCH', u, d ?? {}) };
}

/** A context signed in through the API (no video) for behind-the-scenes set-up. */
export async function staffApi(browser: Browser, who: keyof typeof USERS) {
  const ctx = await browser.newContext();
  const a = await api(ctx);
  await a.post(who === 'partner' ? 'partner-portal/login' : 'auth/login', { email: USERS[who].email, password: USERS[who].password });
  return { ctx, ...a };
}

export async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 300_000, everyMs = 3000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export function listRawClips() {
  return readdirSync(RAW).filter((f) => f.endsWith('.webm')).sort();
}

/** Picks an option once the select has loaded its options (by visible label, or the first real option). */
export async function pick(c: Clip, select: Locator, label?: string | RegExp) {
  select = select.and(c.page.locator('select')).first();
  await center(select);
  await expect.poll(async () => select.locator('option').evaluateAll((os) => (os as HTMLOptionElement[]).filter((o) => o.value).length), { timeout: 60_000 }).toBeGreaterThan(0);
  const b = await select.boundingBox();
  if (b) await c.page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 8 });
  if (label === undefined) {
    const v = await select.locator('option').evaluateAll((os) => (os as HTMLOptionElement[]).find((o) => o.value && !o.disabled)?.value ?? '');
    await select.selectOption(v);
  } else if (typeof label === 'string') {
    const v = await select.locator('option').evaluateAll((os, l) => (os as HTMLOptionElement[]).find((o) => (o.textContent ?? '').trim().startsWith(l))?.value, label);
    if (v === undefined) throw new Error(`no option starting with "${label}"`);
    await select.selectOption(v);
  } else {
    const v = await select.locator('option').evaluateAll((os, src) => (os as HTMLOptionElement[]).find((o) => new RegExp(src).test(o.textContent ?? ''))?.value ?? '', label.source);
    await select.selectOption(v);
  }
  await c.page.waitForTimeout(500);
}

/** A button or link with this exact name (the apps use both for actions). */
export const act = (p: Page, name: string | RegExp) =>
  p.getByRole('button', { name, exact: typeof name === 'string' }).or(p.getByRole('link', { name, exact: typeof name === 'string' })).first();

/** Clicks only if the control appears within a few seconds (optional steps that depend on existing data). */
export async function maybe(c: Clip, l: Locator, ms = 5000) {
  if (await l.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false)) {
    await c.click(l);
    return true;
  }
  return false;
}
