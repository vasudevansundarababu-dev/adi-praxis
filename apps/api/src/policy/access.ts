import type { Actor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { forbidden, notFound } from '../lib/errors';

export const POLICY_ACCESS = ['PM', 'ADMIN'] as const;
export const isAdmin = (actor: Actor) => actor.roles.includes('ADMIN');

/** Same rule as projects: the owning PM and Admins; anyone else gets 404 (no existence leak). */
export async function policyProject(tx: Db | Tx, actor: Actor, projectId: string) {
  const p = await tx.project.findFirst({ where: { id: projectId, clientId: actor.clientId }, select: { id: true, clientId: true, ownerId: true, name: true, templateId: true, templateVersion: true } });
  if (!p || (!isAdmin(actor) && p.ownerId !== actor.userId)) throw notFound('Project not found');
  return p;
}

export async function policyTask(tx: Db | Tx, actor: Actor, taskId: string) {
  const t = await tx.taskInstance.findFirst({ where: { id: taskId, clientId: actor.clientId }, select: { id: true, projectId: true, clientId: true } });
  if (!t) throw notFound('Task not found');
  await policyProject(tx, actor, t.projectId);
  return t;
}

export function requireAdmin(actor: Actor) {
  if (!isAdmin(actor)) throw forbidden('Only an Admin can choose or change the extraction provider.');
}
