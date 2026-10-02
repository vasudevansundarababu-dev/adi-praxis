import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

// argon2id with OWASP-recommended minimums (19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

/** Minimum length for passwords people choose (NIST SP 800-63B: length over composition rules). */
export const MIN_PASSWORD_LENGTH = 12;

// No 0/O, 1/l/I: temporary passwords are read off a screen and typed by someone else.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A temporary password an Admin passes on (about 80 bits): four groups of four, e.g. "kq7m-xt4p-9wzn-r2hc". */
export function generateTemporaryPassword(): string {
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verified against when the email is unknown, so response time doesn't reveal which accounts exist.
let dummyHash: Promise<string> | undefined;
export const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password-placeholder'));
