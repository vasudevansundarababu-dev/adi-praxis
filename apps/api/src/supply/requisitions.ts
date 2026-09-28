import type { Prisma, Requisition } from '@prisma/client';
import { MinimumRequirements, REQUISITION_TRANSITIONS, RequisitionInput, TIER_LABELS, type RequisitionState } from '@praxis/shared';
import type { InternalActor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import type { writeAudit } from '../platform/audit';
import { notifyPartner } from './webhooks';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;

/** Requisitions (docs/SME-SUPPLY.md section 4): created by a PM from a project that has SME supply switched on. */
export const requisitionDto = (r: Requisition, extra: Record<string, unknown> = {}) => ({
  id: r.id,
  projectId: r.projectId,
  title: r.title,
  summary: r.summary,
  domain: r.domain,
  tier: r.tier,
  tierLabel: TIER_LABELS[r.tier],
  headcount: r.headcount,
  startDate: r.startDate?.toISOString().slice(0, 10) ?? null,
  durationWeeks: r.durationWeeks,
  hoursPerWeek: r.hoursPerWeek,
  location: r.location,
  jurisdictions: r.jurisdictions,
  languages: r.languages,
  minimumRequirements: MinimumRequirements.parse(r.minimumRequirements ?? {}),
  allowedPartnerIds: r.allowedPartnerIds,
  directChannel: r.directChannel,
  submissionDeadline: r.submissionDeadline?.toISOString() ?? null,
  maxPerPartner: r.maxPerPartner,
  guidelinesPackageId: r.guidelinesPackageId,
  guidelinesVersion: r.guidelinesVersion,
  rateCardId: r.rateCardId,
  payRoute: r.payRoute,
  state: r.state,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  ...extra,
});

/** What a partner may see: requirements and the partner-facing summary; never items, answers or scoring rules. */
export const partnerRequisitionDto = (r: Requisition, extra: Record<string, unknown> = {}) => {
  const { allowedPartnerIds: _a, rateCardId: _r, guidelinesPackageId: _g, projectId: _p, ...rest } = requisitionDto(r);
  return { ...rest, ...extra };
};

async function supplyProject(tx: Db | Tx, projectId: string, actor: InternalActor) {
  const p = await tx.project.findFirst({ where: { id: projectId, clientId: actor.clientId } });
  if (!p) throw notFound('Project not found');
  if (!actor.roles.includes('ADMIN') && p.ownerId !== actor.userId) throw notFound('Project not found');
  if (!p.smeSupplyEnabled) throw new AppError(409, 'SME_SUPPLY_OFF', 'Switch on SME supply for this project first.');
  return p;
}

export async function loadRequisition(tx: Db | Tx, id: string, actor: InternalActor) {
  const r = await tx.requisition.findFirst({ where: { id, clientId: actor.clientId }, include: { project: true } });
  if (!r || (!actor.roles.includes('ADMIN') && !actor.roles.includes('REVIEWER') && r.project.ownerId !== actor.userId)) throw notFound('Requisition not found');
  return r;
}

async function checkPartners(tx: Tx, clientId: string, ids: string[]) {
  const found = await tx.partner.count({ where: { clientId, id: { in: ids } } });
  if (found !== new Set(ids).size) throw new AppError(422, 'UNKNOWN_PARTNER', 'Every allowed partner must be an onboarded partner.');
}

const dataOf = (i: RequisitionInput) => ({
  title: i.title,
  summary: i.summary,
  domain: i.domain.toLowerCase(),
  tier: i.tier,
  headcount: i.headcount,
  startDate: i.startDate ? new Date(i.startDate) : null,
  durationWeeks: i.durationWeeks,
  hoursPerWeek: i.hoursPerWeek,
  location: i.location,
  jurisdictions: i.jurisdictions,
  languages: i.languages,
  minimumRequirements: i.minimumRequirements as Prisma.InputJsonValue,
  allowedPartnerIds: [...new Set(i.allowedPartnerIds)],
  directChannel: i.directChannel,
  submissionDeadline: i.submissionDeadline ? new Date(i.submissionDeadline) : null,
  maxPerPartner: i.maxPerPartner,
  payRoute: i.payRoute,
});

export async function createRequisition(tx: Tx, actor: InternalActor, input: RequisitionInput, audit: Audit) {
  const p = await supplyProject(tx, input.projectId, actor);
  await checkPartners(tx, actor.clientId, input.allowedPartnerIds);
  const r = await tx.requisition.create({ data: { clientId: actor.clientId, projectId: p.id, createdById: actor.userId, ...dataOf(input) } });
  await audit({ entityType: 'Requisition', entityId: r.id, action: 'requisition.created', after: { state: r.state, tier: r.tier, headcount: r.headcount, partners: r.allowedPartnerIds.length } });
  return r;
}

export async function updateRequisition(tx: Tx, actor: InternalActor, id: string, input: RequisitionInput, audit: Audit) {
  const before = await loadRequisition(tx, id, actor);
  if (before.state === 'CLOSED') throw new AppError(409, 'CLOSED', 'A closed requisition cannot be changed.');
  if (input.projectId !== before.projectId) throw new AppError(422, 'PROJECT_FIXED', 'A requisition stays with its project.');
  await checkPartners(tx, actor.clientId, input.allowedPartnerIds);
  const r = await tx.requisition.update({ where: { id }, data: dataOf(input) });
  await audit({ entityType: 'Requisition', entityId: r.id, action: 'requisition.updated', before: requisitionDto(before), after: requisitionDto(r) });
  if (r.state === 'OPEN') {
    // Partners newly allowed get "opened"; partners still allowed get "updated".
    for (const pid of r.allowedPartnerIds) await notifyPartner(tx, { partnerId: pid, sandbox: false, type: before.allowedPartnerIds.includes(pid) ? 'requisition.updated' : 'requisition.opened', data: { requisition: partnerRequisitionDto(r) } });
  }
  return r;
}

export async function transitionRequisition(tx: Tx, actor: InternalActor, id: string, to: RequisitionState, audit: Audit) {
  const before = await loadRequisition(tx, id, actor);
  if (!REQUISITION_TRANSITIONS[before.state].includes(to)) throw new AppError(409, 'INVALID_TRANSITION', `A ${before.state.toLowerCase()} requisition cannot become ${to.toLowerCase()}.`);
  if (to === 'OPEN' && !before.allowedPartnerIds.length && !before.directChannel) throw new AppError(422, 'NO_CHANNEL', 'Allow at least one partner or the direct channel before opening.');
  const r = await tx.requisition.update({ where: { id }, data: { state: to } });
  await audit({ entityType: 'Requisition', entityId: r.id, action: 'requisition.state_changed', before: { state: before.state }, after: { state: to } });
  const type = to === 'OPEN' ? (before.state === 'DRAFT' ? 'requisition.opened' : 'requisition.updated') : to === 'CLOSED' ? 'requisition.closed' : 'requisition.updated';
  for (const pid of r.allowedPartnerIds) {
    for (const sandbox of [false, true]) await notifyPartner(tx, { partnerId: pid, sandbox, type, data: { requisition: partnerRequisitionDto(r) } });
  }
  return r;
}
