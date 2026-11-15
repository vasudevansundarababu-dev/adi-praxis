import { normEmail, RESET_PASSWORD_LINK_HOURS, SET_PASSWORD_LINK_HOURS, type ForgeSettings } from '@praxis/shared';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import type { EmailSender } from '../lib/email';
import { newToken, sha256 } from '../lib/crypto';
import { AppError } from '../lib/errors';
import type { AuditInput } from '../platform/audit';

type Audit = (i: AuditInput) => Promise<void>;
export type PasswordPurpose = 'set' | 'reset';

/**
 * MVP1 step 6 (docs/design/PROJECT-SCREEN-DESIGN.md, "Admin: candidate app sign-in mode"). In Online mode a person
 * signs in with the email the PM or Admin uploaded and a password they chose through a one-time link. The link is
 * emailed; the password never is. Only hashes are stored: the password's (argon2id) and the link token's (sha256).
 */

/** Password sign-in and links work only in the new flow with the Online mode. */
export const passwordMode = (f: ForgeSettings) => f.newFlow && f.candidateSignIn === 'ONLINE';

export const signInModeError = (online: boolean) =>
  online
    ? new AppError(409, 'SIGN_IN_MODE', 'Sign in with your email and password.')
    : new AppError(409, 'SIGN_IN_MODE', 'Password sign-in is not switched on. Sign in with your email and name.');

/** The account an email signs in to: the one linked from a person a PM or Admin assigned, in this client. */
export async function accountForEmail(db: Db | Tx, clientId: string, email: string): Promise<string | null> {
  const rows = await db.sourcedPerson.findMany({
    where: { clientId, emailNorm: normEmail(email), assignedAt: { not: null }, smeUserId: { not: null }, smeUser: { anonymizedAt: null } },
    select: { smeUserId: true },
  });
  const ids = [...new Set(rows.map((r) => r.smeUserId!))];
  if (ids.length <= 1) return ids[0] ?? null;
  // Several accounts for one email (an edge case from before the claim): only the one with a password can sign in.
  const withPassword = await db.candidateCredential.findMany({ where: { smeUserId: { in: ids } }, select: { smeUserId: true } });
  return withPassword.length === 1 ? withPassword[0]!.smeUserId : null;
}

/** Every email this account is known by, for the "no email name in the password" rule. */
export async function accountEmails(db: Db | Tx, smeUserId: string): Promise<string[]> {
  const u = await db.smeUser.findUnique({ where: { id: smeUserId }, select: { contactEmail: true } });
  const rows = await db.sourcedPerson.findMany({ where: { smeUserId }, select: { emailNorm: true } });
  return [...new Set([...(u?.contactEmail ? [u.contactEmail] : []), ...rows.map((r) => r.emailNorm)])];
}

/** A fresh one-time link token. Only its sha256 is stored. */
export async function createPasswordToken(tx: Tx, args: { clientId: string; smeUserId: string; purpose: PasswordPurpose }) {
  const token = newToken();
  const hours = args.purpose === 'set' ? SET_PASSWORD_LINK_HOURS : RESET_PASSWORD_LINK_HOURS;
  const row = await tx.candidatePasswordToken.create({
    data: { clientId: args.clientId, smeUserId: args.smeUserId, tokenHash: sha256(token), purpose: args.purpose, expiresAt: new Date(Date.now() + hours * 3600_000) },
  });
  return { token, row };
}

export const passwordLink = (config: Pick<Config, 'CANDIDATE_APP_URL'>, token: string) => `${config.CANDIDATE_APP_URL}/set-password/${token}`;

/** The email with the link. Plain instructions; the password is never asked for or sent. */
export async function sendPasswordEmail(email: EmailSender, config: Pick<Config, 'CANDIDATE_APP_URL'>, m: { to: string; name?: string | null; token: string; purpose: PasswordPurpose }) {
  const link = passwordLink(config, m.token);
  const text =
    m.purpose === 'set'
      ? [
          `Hello${m.name ? ` ${m.name}` : ''},`,
          '',
          'You have been given tasks in ADI Forge. To start, set your password:',
          link,
          '',
          `Then sign in with this email address (${m.to}) and your new password.`,
          `The link works once and expires in ${SET_PASSWORD_LINK_HOURS} hours. If it has expired, ask your project manager for a new one.`,
          'We will never ask for your password. Never reply to this email with a password.',
        ]
      : [
          'Hello,',
          '',
          'Someone asked to reset the password for this email address in ADI Forge. To choose a new password, open:',
          link,
          '',
          `The link works once and expires in ${RESET_PASSWORD_LINK_HOURS} hour. If you did not ask for this, you can ignore this email; your password stays the same.`,
          'We will never ask for your password. Never reply to this email with a password.',
        ];
  await email.send({ to: m.to, subject: m.purpose === 'set' ? 'Your ADI Forge account' : 'Reset your ADI Forge password', text: text.join('\n') });
}

/**
 * On a direct assignment in Online mode: a set-your-password link for a person with no password and no live link yet.
 * Runs inside the assignment's command; the email goes after the database work, so a failed send undoes the command.
 */
export async function setLinkOnAssign(tx: Tx, deps: { email: EmailSender; config: Pick<Config, 'CANDIDATE_APP_URL'> }, f: ForgeSettings, sourcedPersonId: string, audit: Audit) {
  if (!passwordMode(f)) return false;
  const s = await tx.sourcedPerson.findUniqueOrThrow({ where: { id: sourcedPersonId } });
  if (!s.smeUserId) return false;
  await tx.$executeRaw`SELECT 1 FROM "SmeUser" WHERE id = ${s.smeUserId}::uuid FOR UPDATE`;
  if (await tx.candidateCredential.findUnique({ where: { smeUserId: s.smeUserId } })) return false;
  const live = await tx.candidatePasswordToken.count({ where: { smeUserId: s.smeUserId, purpose: 'set', usedAt: null, expiresAt: { gt: new Date() } } });
  if (live) return false;
  const { token, row } = await createPasswordToken(tx, { clientId: s.clientId, smeUserId: s.smeUserId, purpose: 'set' });
  await audit({ entityType: 'SmeUser', entityId: s.smeUserId, action: 'candidate.password_link_sent', after: { sourcedPersonId: s.id, tokenId: row.id, purpose: 'set', onAssign: true, expiresAt: row.expiresAt } });
  await sendPasswordEmail(deps.email, deps.config, { to: s.emailNorm, name: s.firstName, token, purpose: 'set' });
  return true;
}

/** Resend: earlier unused set links stop working (deleted; only hashes were kept) and a new one is emailed. */
export async function resendSetLink(tx: Tx, deps: { email: EmailSender; config: Pick<Config, 'CANDIDATE_APP_URL'> }, sourcedPersonId: string, audit: Audit) {
  const s = await tx.sourcedPerson.findUniqueOrThrow({ where: { id: sourcedPersonId } });
  if (!s.smeUserId || s.assignedAt === null || s.releasedAt !== null) throw new AppError(409, 'NOT_ASSIGNED', 'This person is not assigned to the project.');
  await tx.$executeRaw`SELECT 1 FROM "SmeUser" WHERE id = ${s.smeUserId}::uuid FOR UPDATE`;
  const { count: replaced } = await tx.candidatePasswordToken.deleteMany({ where: { smeUserId: s.smeUserId, purpose: 'set', usedAt: null } });
  const { token, row } = await createPasswordToken(tx, { clientId: s.clientId, smeUserId: s.smeUserId, purpose: 'set' });
  await audit({ entityType: 'SmeUser', entityId: s.smeUserId, action: 'candidate.password_link_sent', after: { sourcedPersonId: s.id, tokenId: row.id, purpose: 'set', onAssign: false, replaced, expiresAt: row.expiresAt } });
  await sendPasswordEmail(deps.email, deps.config, { to: s.emailNorm, name: s.firstName, token, purpose: 'set' });
  return { expiresAt: row.expiresAt };
}
