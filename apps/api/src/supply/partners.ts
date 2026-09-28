import { PARTNER_SCOPES, PARTNER_WEBHOOK_EVENTS, type PartnerScope } from '@praxis/shared';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { sha256 } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import type { SecretBox } from '../lib/secrets';

/** Partner onboarding, OAuth clients and webhooks (docs/SME-SUPPLY.md sections 5 and 9). */

export const PartnerInput = z.object({
  name: z.string().trim().min(2).max(200),
  businessVerification: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('PENDING'),
  contacts: z.array(z.object({ name: z.string().trim().min(1).max(200), email: z.string().email(), role: z.string().trim().max(100).optional() })).max(20).default([]),
  allowedDomains: z.array(z.string().trim().min(2).max(60)).max(20).default([]),
  allowedTiers: z.array(z.enum(['EXPERT', 'REVIEWER_SME', 'ANNOTATOR'])).max(3).default([]),
  feeTermsVersion: z.string().trim().max(60).nullable().default(null),
});

export const PartnerUserInput = z.object({ email: z.string().trim().email().max(320), name: z.string().trim().min(1).max(200), password: z.string().min(12).max(200) });

export const ClientInput = z.object({ environment: z.enum(['SANDBOX', 'LIVE']), scopes: z.array(z.enum(PARTNER_SCOPES)).min(1).default([...PARTNER_SCOPES]) });

export const WebhookInput = z.object({
  url: z.string().url().max(2000).refine((u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u), 'Webhook URLs must use HTTPS'),
  events: z.array(z.enum([...PARTNER_WEBHOOK_EVENTS, '*'] as [string, ...string[]])).min(1).default(['*']),
  environment: z.enum(['SANDBOX', 'LIVE']),
});

const secret = (prefix: string) => `${prefix}_${randomBytes(24).toString('base64url')}`;

export const partnerDto = (p: { id: string; name: string; status: string; businessVerification: string; contacts: unknown; allowedDomains: string[]; allowedTiers: string[]; feeTermsVersion: string | null; createdAt: Date }) => ({
  id: p.id,
  name: p.name,
  status: p.status,
  businessVerification: p.businessVerification,
  contacts: p.contacts,
  allowedDomains: p.allowedDomains,
  allowedTiers: p.allowedTiers,
  feeTermsVersion: p.feeTermsVersion,
  createdAt: p.createdAt.toISOString(),
});

export const clientDto = (c: { id: string; publicId: string; scopes: string[]; environment: string; rotatedAt: Date | null; revokedAt: Date | null; createdAt: Date }) => ({
  id: c.id,
  clientId: c.publicId,
  scopes: c.scopes,
  environment: c.environment,
  rotatedAt: c.rotatedAt?.toISOString() ?? null,
  revokedAt: c.revokedAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
});

/** Issues a client; the secret is returned once and stored only as a hash. */
export async function createClient(tx: Tx, partnerId: string, input: z.infer<typeof ClientInput>) {
  const { clientId } = await tx.partner.findUniqueOrThrow({ where: { id: partnerId } });
  const env = input.environment === 'SANDBOX' ? 'test' : 'live';
  const publicId = `pc_${env}_${randomBytes(9).toString('base64url')}`;
  const clientSecret = secret(`pcs_${env}`);
  const c = await tx.partnerClient.create({ data: { clientId, partnerId, publicId, secretHash: sha256(clientSecret), scopes: input.scopes, environment: input.environment } });
  return { client: c, clientSecret };
}

export async function rotateClient(tx: Tx, partnerId: string, id: string) {
  const c = await tx.partnerClient.findFirst({ where: { id, partnerId, revokedAt: null } });
  if (!c) throw notFound('Client not found');
  const clientSecret = secret(`pcs_${c.environment === 'SANDBOX' ? 'test' : 'live'}`);
  // Rotation ends every token issued with the old secret.
  await tx.partnerAccessToken.deleteMany({ where: { clientRef: c.id } });
  const updated = await tx.partnerClient.update({ where: { id: c.id }, data: { secretHash: sha256(clientSecret), rotatedAt: new Date() } });
  return { client: updated, clientSecret };
}

export async function revokeClient(tx: Tx, partnerId: string, id: string) {
  const c = await tx.partnerClient.findFirst({ where: { id, partnerId } });
  if (!c) throw notFound('Client not found');
  await tx.partnerAccessToken.deleteMany({ where: { clientRef: c.id } });
  return tx.partnerClient.update({ where: { id: c.id }, data: { revokedAt: c.revokedAt ?? new Date() } });
}

export class OAuthError extends AppError {
  constructor(code: 'invalid_request' | 'invalid_client' | 'unsupported_grant_type' | 'invalid_scope', message: string) {
    super(code === 'invalid_client' ? 401 : 400, code, message);
  }
}

/** OAuth2 client-credentials grant (RFC 6749 section 4.4). Requested scopes must be a subset of the client's. */
export async function issueToken(db: Db, body: Record<string, unknown>, basicAuth: string | undefined, ttlSeconds: number) {
  let id = typeof body.client_id === 'string' ? body.client_id : '';
  let sec = typeof body.client_secret === 'string' ? body.client_secret : '';
  const basic = basicAuth?.match(/^Basic\s+(\S+)$/);
  if (basic) {
    const [u, p] = Buffer.from(basic[1]!, 'base64').toString('utf8').split(':');
    id = decodeURIComponent(u ?? '');
    sec = decodeURIComponent(p ?? '');
  }
  if (body.grant_type !== 'client_credentials') throw new OAuthError('unsupported_grant_type', 'Only grant_type=client_credentials is supported.');
  if (!id || !sec) throw new OAuthError('invalid_request', 'client_id and client_secret are required.');
  const c = await db.partnerClient.findUnique({ where: { publicId: id }, include: { partner: true } });
  // Same answer for an unknown client and a wrong secret.
  if (!c || c.revokedAt || c.secretHash !== sha256(sec) || c.partner.status !== 'ACTIVE') throw new OAuthError('invalid_client', 'Client authentication failed.');
  const asked = typeof body.scope === 'string' && body.scope.trim() ? (body.scope.trim().split(/\s+/) as PartnerScope[]) : c.scopes;
  if (asked.some((s) => !c.scopes.includes(s))) throw new OAuthError('invalid_scope', 'A requested scope is not granted to this client.');
  const token = secret('pat');
  await db.partnerAccessToken.create({ data: { clientId: c.partner.clientId, clientRef: c.id, tokenHash: sha256(token), scopes: asked, expiresAt: new Date(Date.now() + ttlSeconds * 1000) } });
  await db.auditEvent.create({ data: { clientId: c.partner.clientId, actorType: 'PARTNER', actorId: `partner-client:${c.id}`, entityType: 'PartnerClient', entityId: c.id, action: 'partner.token_issued', after: { scopes: asked, environment: c.environment } } });
  return { access_token: token, token_type: 'Bearer', expires_in: ttlSeconds, scope: asked.join(' ') };
}

/** A webhook's signing secret is shown once; it is stored encrypted because it is needed to sign every delivery. */
export async function createWebhook(tx: Tx, box: SecretBox, partnerId: string, input: z.infer<typeof WebhookInput>) {
  const { clientId } = await tx.partner.findUniqueOrThrow({ where: { id: partnerId } });
  const signingSecret = secret('whsec');
  const w = await tx.partnerWebhook.create({ data: { clientId, partnerId, url: input.url, events: input.events, environment: input.environment, secretEnc: box.encrypt(signingSecret) } });
  return { webhook: w, signingSecret };
}

export const webhookDto = (w: { id: string; url: string; events: string[]; environment: string; status: string; createdAt: Date }) => ({ id: w.id, url: w.url, events: w.events, environment: w.environment, status: w.status, createdAt: w.createdAt.toISOString() });
