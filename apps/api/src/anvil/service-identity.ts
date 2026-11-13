import { OAuth2Client } from 'google-auth-library';

/**
 * Keyless Praxis <-> Anvil authentication (owner, 12 Nov 2026: "no API keys between Anvil and Praxis").
 *
 * Each service proves who it is with a short-lived, Google-signed OIDC identity token for its own runtime service
 * account. Nothing is issued, pasted, stored or rotated by people. Praxis still authorises the caller: the pinned
 * account (configuration, not a secret) must also hold a grant row (`ensureAnvilGrant`, made by the deploy's setup job)
 * that an Admin can revoke, and the pilot stop (ANVIL_CREDENTIAL_NOT_AFTER) ends it.
 */

/** K6 (12 Nov 2026): exactly this issuer; RS256 signatures from Google's published keys. */
const GOOGLE_ISSUER = 'https://accounts.google.com';

/** A verified calling service: its Google service-account e-mail, lower case. */
export interface ServiceCaller {
  email: string;
  subject: string;
}

export interface ServiceIdentityVerifier {
  /** Null when the token is not a valid Google identity token for our audience with a verified e-mail. */
  verify(token: string): Promise<ServiceCaller | null>;
}

/** A Bearer value shaped like a JWT (three base64url parts). API keys never contain dots. */
export const JWT_BEARER = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Checks signature (Google's published certs, RS256), exact issuer, exact audience (this Praxis API's URL), issue and
 * expiry time, and that the token is for exactly the pinned caller: numeric subject AND service-account e-mail.
 * `loadCerts` is injectable so tests sign tokens with a local key instead of calling Google.
 */
export class GoogleServiceIdentityVerifier implements ServiceIdentityVerifier {
  private readonly client = new OAuth2Client();

  constructor(
    private readonly expected: { audience: string; subject: string; email: string },
    private readonly loadCerts: () => Promise<Record<string, string>> = async () => (await this.client.getFederatedSignonCertsAsync()).certs as Record<string, string>,
  ) {
    if (!expected.audience || !expected.subject || !expected.email) throw new Error('Keyless inbound needs an audience, subject and service account');
    if (!/^\d{10,30}$/.test(expected.subject)) throw new Error('The caller subject must be the numeric Google service-account ID');
    if (!/^https:\/\/[^/\s]+$/.test(expected.audience)) throw new Error('The audience must be an exact https origin');
  }

  async verify(token: string): Promise<ServiceCaller | null> {
    try {
      const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as { alg?: string };
      if (header.alg !== 'RS256') return null;
      const ticket = await this.client.verifySignedJwtWithCertsAsync(token, await this.loadCerts(), this.expected.audience, [GOOGLE_ISSUER]);
      const p = ticket.getPayload();
      if (!p || p.iss !== GOOGLE_ISSUER || p.aud !== this.expected.audience) return null;
      if (p.sub !== this.expected.subject || p.email?.toLowerCase() !== this.expected.email.toLowerCase() || p.email_verified !== true) return null;
      return { email: p.email.toLowerCase(), subject: p.sub };
    } catch {
      return null;
    }
  }
}

/**
 * Outbound: a Google identity token for this service's attached runtime account, for `audience` (Anvil), fetched ONLY
 * from the Cloud Run / GCE metadata server (never a key file or other credential source). Bounded: 5 s timeout; the token
 * is cached in memory until 5 minutes before it expires and is never logged.
 */
export function googleIdTokenProvider(audience: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5000): () => Promise<string> {
  const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
  let cached: { token: string; exp: number } | null = null;
  return async () => {
    if (cached && cached.exp - 300 > Date.now() / 1000) return cached.token;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { 'Metadata-Flavor': 'Google' }, signal: ctrl.signal, redirect: 'error' });
      if (res.status !== 200) throw new Error(`metadata server answered ${res.status}`);
      const token = (await res.text()).trim();
      const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
      if (!JWT_BEARER.test(`Bearer ${token}`) || typeof payload.exp !== 'number') throw new Error('metadata server returned no identity token');
      cached = { token, exp: payload.exp };
      return token;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Default audience for calls to Anvil: the origin of its export base URL. */
export function anvilAudience(baseUrl: string, configured = ''): string {
  return configured || new URL(baseUrl).origin;
}
