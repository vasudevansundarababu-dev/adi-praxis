import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { roleLabel } from '@praxis/shared';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { SupportUnavailableError, type SupportAssistant, type SupportContext } from '../support/assistant';
import { HELP_VERSION, PARTNER_HELP, STAFF_HELP } from '../support/help-pack';

/**
 * Support Bot API (docs/SUPPORT-BOT.md). The browser sends the question, the recent conversation and a description of
 * the screen (title, headings, form fields with their required flags and options). The record on screen is fetched
 * here by replaying the matching read-only API call with the user's own session cookie, so the bot only ever sees what
 * the user could already see. The bot explains; it never changes anything. Questions are not stored.
 */
const Field = z.object({
  label: z.string().max(200),
  name: z.string().max(100).optional(),
  type: z.string().max(30),
  required: z.boolean(),
  value: z.string().max(500).optional(),
  options: z.array(z.string().max(200)).max(50).optional(),
  help: z.string().max(300).optional(),
});
export const SupportAsk = z.object({
  question: z.string().trim().min(2).max(2000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) })).max(10).default([]),
  screen: z.object({
    path: z.string().regex(/^\/[\w\-./]*$/).max(300),
    title: z.string().max(200).default(''),
    headings: z.array(z.string().max(200)).max(20).default([]),
    messages: z.array(z.string().max(300)).max(10).default([]),
    fields: z.array(Field).max(80).default([]),
  }),
});

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Web path → read-only API path(s) that describe the record on screen. First match wins. */
const STAFF_RECORDS: [RegExp, (m: RegExpMatchArray) => string, string][] = [
  [new RegExp(`^/payments/pay-runs/(${UUID})`), (m) => `/pay-runs/${m[1]}`, 'pay run'],
  [/^\/payments\/pay-runs\/?$/, () => '/pay-runs', 'pay-run list'],
  [/^\/payments\/exceptions\/?$/, () => '/payout-exceptions', 'payout exceptions'],
  [/^\/payments\/rate-cards\/?$/, () => '/rate-cards', 'rate cards'],
  [/^\/payments\/statements\/?$/, () => '/partner-statements', 'partner statements'],
  [new RegExp(`^/requisitions/(${UUID})`), (m) => `/requisitions/${m[1]}`, 'requisition'],
  [/^\/requisitions\/?$/, () => '/requisitions', 'requisition list'],
  [new RegExp(`^/partners/(${UUID})`), (m) => `/partners/${m[1]}`, 'partner'],
  [/^\/partners\/?$/, () => '/partners', 'partner list'],
  [new RegExp(`^/guidelines/versions/(${UUID})`), (m) => `/guidelines/versions/${m[1]}`, 'guidelines version'],
  [new RegExp(`^/guidelines/courses/(${UUID})`), (m) => `/courses/${m[1]}`, 'course'],
  [new RegExp(`^/guidelines/blueprints/(${UUID})`), (m) => `/blueprints/${m[1]}`, 'blueprint'],
  [/^\/guidelines\/?$/, () => '/guidelines/packages', 'guidelines packages'],
  [/^\/certifications\/?$/, () => '/certifications/review-queue', 'certification review queue'],
  [new RegExp(`^/review/applications/(${UUID})`), (m) => `/review/enrollments/${m[1]}`, 'application'],
  [new RegExp(`^/projects/(${UUID})`), (m) => `/projects/${m[1]}`, 'project'],
  [new RegExp(`^/templates/(${UUID})`), (m) => `/templates/${m[1]}`, 'template'],
];
const PARTNER_RECORDS: [RegExp, (m: RegExpMatchArray) => string, string][] = [
  [new RegExp(`^/partner/requisitions/(${UUID})`), (m) => `/partner-portal/requisitions/${m[1]}`, 'requisition'],
  [/^\/partner\/requisitions\/?$/, () => '/partner-portal/requisitions', 'requisition list'],
  [new RegExp(`^/partner/candidates/(${UUID})`), (m) => `/partner-portal/candidates/${m[1]}`, 'candidate'],
  [/^\/partner\/candidates\/?$/, () => '/partner-portal/candidates', 'candidate list'],
  [/^\/partner\/statements\/?$/, () => '/partner-portal/statements', 'statements'],
];

/** Keys that never go to the model, whatever an API returns (defence in depth; APIs do not return secrets anyway). */
const SECRET_KEY = /(secret|password|token|hash|keyEnc|signing|apiKey|authorization)/i;
export function scrub(v: unknown, depth = 0): unknown {
  if (depth > 8) return '…';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SECRET_KEY.test(k)).map(([k, x]) => [k, scrub(x, depth + 1)]));
  if (typeof v === 'string') return v.slice(0, 1000);
  return v;
}

async function recordFor(app: FastifyInstance, req: FastifyRequest, table: typeof STAFF_RECORDS, path: string) {
  for (const [re, api, source] of table) {
    const m = path.match(re);
    if (!m) continue;
    // Same cookies, same permission checks: a record the user cannot open is simply not included.
    const res = await app.inject({ method: 'GET', url: `/api/v1${api(m)}`, headers: { cookie: req.headers.cookie ?? '' } });
    if (res.statusCode !== 200) return null;
    try {
      return { source, data: scrub(res.json()) };
    } catch {
      return null;
    }
  }
  return null;
}

const perSession = (cookie: string) => ({ max: 20, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => r.cookies?.[cookie] ?? r.ip });

export const supportRoutes: FastifyPluginAsyncZod<{ assistant: SupportAssistant; partnerPortal: boolean }> = async (app, { assistant, partnerPortal }) => {
  const root = app as unknown as FastifyInstance;
  const ask = async (req: FastifyRequest, ctx: Omit<SupportContext, 'record' | 'screen'>, body: z.infer<typeof SupportAsk>, table: typeof STAFF_RECORDS) => {
    const record = await recordFor(root, req, table, body.screen.path);
    const started = Date.now();
    try {
      const r = await assistant.answer({ ...ctx, screen: body.screen, record }, body.history, body.question);
      req.log.info({ support: { audience: ctx.audience, path: body.screen.path, record: record?.source ?? null, model: assistant.model, ms: Date.now() - started, ...r.usage } }, 'support answer');
      return { answer: r.answer, model: assistant.model, helpVersion: HELP_VERSION, usedRecord: record?.source ?? null };
    } catch (err) {
      if (err instanceof SupportUnavailableError) throw new AppError(503, 'SUPPORT_UNAVAILABLE', 'The Support Bot is not available right now. Try again in a minute, or ask an Admin.');
      throw err;
    }
  };

  app.post('/support/ask', { config: { access: ['ADMIN', 'PM', 'REVIEWER', 'FINANCE'], rateLimit: perSession('praxis_session') }, schema: { tags: ['support'], body: SupportAsk } }, async (req) =>
    ask(req, { audience: 'STAFF', roles: req.actor!.roles.map(roleLabel), help: STAFF_HELP }, req.body, STAFF_RECORDS),
  );

  if (partnerPortal) {
    app.post('/partner-portal/support/ask', { config: { access: 'partner', rateLimit: perSession('praxis_partner') }, schema: { tags: ['support'], body: SupportAsk } }, async (req) =>
      ask(req, { audience: 'PARTNER', roles: ['Partner'], help: PARTNER_HELP }, req.body, PARTNER_RECORDS),
    );
  }
};
