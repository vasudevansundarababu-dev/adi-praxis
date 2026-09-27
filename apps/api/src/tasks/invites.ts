import { INVITE_DAYS } from '@praxis/shared';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import type { EmailSender } from '../lib/email';
import { newToken, sha256 } from '../lib/crypto';
import { AppError } from '../lib/errors';
import type { EventHandler } from '../outbox/handlers';
import { writeAudit } from '../platform/audit';
import { activeAssignment, allocateTasks } from './task-service';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;

/** A fresh single-use invite (SPEC FLOW 3): only the token's hash is stored; it expires in 7 days. */
export async function createInvite(tx: Tx, args: { clientId: string; projectAssignmentId: string }, audit: Audit) {
  const token = newToken();
  const invite = await tx.invite.create({
    data: { clientId: args.clientId, projectAssignmentId: args.projectAssignmentId, tokenHash: sha256(token), channel: 'EMAIL', expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
  });
  await audit({ entityType: 'Invite', entityId: invite.id, action: 'invite.created', after: { projectAssignmentId: args.projectAssignmentId, expiresAt: invite.expiresAt } });
  return { invite, token };
}

/** Sends the invite link. The link identifies the invite, not the session: the candidate still signs in. */
export async function sendInvite(tx: Db | Tx, email: EmailSender, config: Config, inviteId: string, token: string) {
  const inv = await tx.invite.findUniqueOrThrow({ where: { id: inviteId }, include: { projectAssignment: { include: { project: true, candidate: { include: { smeUser: true } } } } } });
  const to = inv.projectAssignment.candidate.smeUser?.contactEmail;
  if (!to) throw new AppError(409, 'NO_CONTACT', 'This expert has no contact email on file.');
  const name = inv.projectAssignment.candidate.smeUser?.displayName;
  await email.send({
    to,
    subject: `Your tasks for ${inv.projectAssignment.project.name} are ready`,
    text: [
      `Hello${name ? ` ${name}` : ''},`,
      '',
      `Your tasks for "${inv.projectAssignment.project.name}" are ready.`,
      `Open them here: ${config.CANDIDATE_APP_URL}/invites/${token}`,
      '',
      `The link works once, only for your account, and expires in ${INVITE_DAYS} days. You will be asked to sign in.`,
      'Use synthetic data only. Never include real customer, colleague or employer information.',
    ].join('\n'),
  });
  await tx.invite.update({ where: { id: inviteId }, data: { sentAt: new Date() } });
}

/**
 * FLOW 3 trigger: when an expert accepts an assignment (`candidate.assigned`), issue their first tasks and send one
 * invite. Runs outside a long transaction because it sends email; every step is idempotent so retries are safe.
 */
export function issueTasksOnAssigned(deps: { email: EmailSender; config: Config }): EventHandler {
  return {
    name: 'flow3.issue-tasks-and-invite',
    event: 'candidate.assigned',
    async run(event, db) {
      const { projectId, candidateId } = event.payload as { projectId: string; candidateId: string };
      const system = { clientId: event.clientId, actorType: 'SYSTEM' as const, actorId: 'task-generator' };
      const pending = await db.$transaction(async (tx) => {
        const audit: Audit = (i) => writeAudit(tx, system, i);
        const pa = await activeAssignment(tx, projectId, candidateId);
        if (!pa) return null; // released or cancelled meanwhile
        const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
        if (!(await tx.taskInstance.count({ where: { projectId, assignedToId: candidateId } }))) {
          try {
            await allocateTasks(tx, { projectId, candidateId, want: project.openTaskCapPerCandidate }, audit);
          } catch (err) {
            if (!(err instanceof AppError)) throw err; // e.g. project paused: the invite still goes; tasks come later
          }
        }
        const existing = await tx.invite.findFirst({ where: { projectAssignmentId: pa.id, revoked: false }, orderBy: { createdAt: 'desc' } });
        if (existing?.sentAt) return null;
        if (existing) {
          // A retry after a failed send: rotate the token (only its hash was kept) and try again.
          const token = newToken();
          await tx.invite.update({ where: { id: existing.id }, data: { tokenHash: sha256(token) } });
          return { inviteId: existing.id, token };
        }
        const { invite, token } = await createInvite(tx, { clientId: event.clientId, projectAssignmentId: pa.id }, audit);
        return { inviteId: invite.id, token };
      }, { timeout: 15_000 });
      if (!pending) return;
      await db.$transaction(async (tx) => {
        await sendInvite(tx, deps.email, deps.config, pending.inviteId, pending.token);
        await writeAudit(tx, system, { entityType: 'Invite', entityId: pending.inviteId, action: 'invite.sent', after: { channel: 'EMAIL' } });
      });
    },
  };
}

/** Redeems an invite for the signed-in candidate it was issued to. Single use; expired or revoked links fail. */
export async function redeemInvite(tx: Tx, token: string, smeUserId: string, audit: Audit) {
  const inv = await tx.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { projectAssignment: { include: { candidate: true } } } });
  // One message for every failure, so a link reveals nothing about other accounts.
  const invalid = new AppError(410, 'INVITE_INVALID', 'This link has expired or was already used. Open your projects from your home page.');
  if (!inv || inv.revoked || inv.expiresAt <= new Date() || inv.projectAssignment.candidate.smeUserId !== smeUserId) throw invalid;
  const { count } = await tx.invite.updateMany({ where: { id: inv.id, usedAt: null }, data: { usedAt: new Date() } });
  if (!count) throw invalid;
  await audit({ entityType: 'Invite', entityId: inv.id, action: 'invite.redeemed', after: { projectId: inv.projectAssignment.projectId } });
  return { projectId: inv.projectAssignment.projectId };
}
