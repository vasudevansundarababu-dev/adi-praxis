import { OAuth2Client } from 'google-auth-library';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../lib/errors';

/** What sign-in needs from Google. The stable subject is the identity key; email is a contact default only. */
export interface GoogleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** FLOW2-SME C01: the server validates the Google credential before issuing a platform session. */
export interface GoogleVerifier {
  readonly mode: 'google' | 'mock';
  verify(credential: string): Promise<GoogleIdentity>;
}

const invalid = () => new AppError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google sign-in could not be verified. Please try again.');
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Real verifier: checks signature (Google's published certs), issuer, audience (our client id) and expiry.
 * `loadCerts` is injectable so tests can sign tokens with a local key instead of calling Google.
 */
export class GoogleIdTokenVerifier implements GoogleVerifier {
  readonly mode = 'google' as const;
  private readonly client = new OAuth2Client();

  constructor(
    private readonly clientId: string,
    private readonly loadCerts: () => Promise<Record<string, string>> = async () => (await this.client.getFederatedSignonCertsAsync()).certs as Record<string, string>,
  ) {}

  async verify(credential: string): Promise<GoogleIdentity> {
    try {
      const ticket = await this.client.verifySignedJwtWithCertsAsync(credential, await this.loadCerts(), this.clientId, GOOGLE_ISSUERS);
      const p = ticket.getPayload();
      if (!p?.sub) throw invalid();
      return { subject: p.sub, email: p.email ?? null, emailVerified: p.email_verified === true, name: p.name ?? null };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw invalid();
    }
  }
}

/**
 * LOCAL DEV / TESTS ONLY: HMAC-signed stand-in credentials ("mock.<payload>.<sig>") minted by the dev sign-in
 * screen. Refused in production by configuration.
 */
export class MockGoogleVerifier implements GoogleVerifier {
  readonly mode = 'mock' as const;
  constructor(private readonly secret: string) {}

  mint(identity: { subject: string; email: string; name: string }, ttlSeconds = 600): string {
    const payload = Buffer.from(
      JSON.stringify({ sub: identity.subject, email: identity.email, name: identity.name, aud: 'praxis-mock', exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
    ).toString('base64url');
    return `mock.${payload}.${this.sign(payload)}`;
  }

  async verify(credential: string): Promise<GoogleIdentity> {
    const [prefix, payload, sig] = credential.split('.');
    if (prefix !== 'mock' || !payload || !sig) throw invalid();
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string; email?: string; name?: string; aud?: string; exp?: number };
    if (!p.sub || p.aud !== 'praxis-mock' || !p.exp || p.exp < Date.now() / 1000) throw invalid();
    return { subject: p.sub, email: p.email ?? null, emailVerified: true, name: p.name ?? null };
  }

  private sign(payload: string) {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
