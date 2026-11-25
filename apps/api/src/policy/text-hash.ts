import { createHash } from 'node:crypto';

/**
 * C1 rule identity (KYC Judgment v1, contracts at Studio 1ba841d): the SHA-256 of a rule version's text as UTF-8 bytes,
 * exactly as served (no trimming or normalisation), lower-case hex. The one function behind the library export, policy
 * clauses and the S4 picker, so the hashes can never drift.
 */
export const textSha256 = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
