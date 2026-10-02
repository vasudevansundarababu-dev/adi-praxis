import { RequisitionInput, REQUISITION_STATES } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { clientDto, partnerDto, PartnerInput, PartnerUserInput } from '../supply/partners';
import { createRequisition, loadRequisition, requisitionDto, transitionRequisition, updateRequisition } from '../supply/requisitions';
import { candidateView, decideScreen } from '../supply/submissions';

const IdParams = z.object({ id: z.string().uuid() });
const ADMIN = ['ADMIN'] as const;
const PLAN = ['ADMIN', 'PM'] as const;
const SEE = ['ADMIN', 'PM', 'REVIEWER'] as const;
const VALIDATE = ['ADMIN', 'REVIEWER'] as const;

/** M10 internal routes (Admin, PM, Validator): partners, requisitions, submissions and the requirement screen. */
export const supplyInternalRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // ── Per-project switch (with the global flag) ──
  app.post('/projects/:id/sme-supply', { config: { access: PLAN }, schema: { tags: ['supply'], params: IdParams, body: z.object({ enabled: z.boolean() }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await tx.project.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!p || (!actor.roles.includes('ADMIN') && p.ownerId !== actor.userId)) throw notFound('Project not found');
      await tx.project.update({ where: { id: p.id }, data: { smeSupplyEnabled: req.body.enabled } });
      await audit({ entityType: 'Project', entityId: p.id, action: 'project.sme_supply_changed', before: { enabled: p.smeSupplyEnabled }, after: { enabled: req.body.enabled } });
      return { status: 200, body: { projectId: p.id, smeSupplyEnabled: req.body.enabled } };
    });
    return reply;
  });

  // ── Partners (Admin onboards partners and their first users) ──
  app.get('/partners', { config: { access: PLAN }, schema: { tags: ['supply'] } }, async (req) => {
    const rows = await db.partner.findMany({ where: { clientId: req.actor!.clientId }, orderBy: { name: 'asc' }, include: { _count: { select: { users: true, clients: true, submissions: true } } } });
    return { items: rows.map((p) => ({ ...partnerDto(p), users: p._count.users, clients: p._count.clients, submissions: p._count.submissions })) };
  });

  app.get('/partners/:id', { config: { access: ADMIN }, schema: { tags: ['supply'], params: IdParams } }, async (req) => {
    const p = await db.partner.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId }, include: { users: true, clients: true, webhooks: true } });
    if (!p) throw notFound('Partner not found');
    return {
      ...partnerDto(p),
      users: p.users.map((u) => ({ id: u.id, email: u.email, name: u.name, status: u.status, mustChangePassword: u.mustChangePassword, lastLoginAt: u.lastLoginAt?.toISOString() ?? null })),
      clients: p.clients.map(clientDto),
      webhooks: p.webhooks.map((w) => ({ id: w.id, url: w.url, events: w.events, environment: w.environment, status: w.status })),
    };
  });

  app.post('/partners', { config: { access: ADMIN }, schema: { tags: ['supply'], body: PartnerInput } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      if (await tx.partner.findUnique({ where: { clientId_name: { clientId: actor.clientId, name: req.body.name } } })) throw new AppError(409, 'PARTNER_EXISTS', 'A partner with this name already exists.');
      const p = await tx.partner.create({ data: { clientId: actor.clientId, ...req.body } });
      await audit({ entityType: 'Partner', entityId: p.id, action: 'partner.created', after: partnerDto(p) });
      return { status: 201, body: partnerDto(p) };
    });
    return reply;
  });

  app.patch('/partners/:id', { config: { access: ADMIN }, schema: { tags: ['supply'], params: IdParams, body: PartnerInput.partial().extend({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const before = await tx.partner.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!before) throw notFound('Partner not found');
      const p = await tx.partner.update({ where: { id: before.id }, data: req.body });
      if (req.body.status === 'SUSPENDED') await tx.partnerAccessToken.deleteMany({ where: { client: { partnerId: p.id } } });
      await audit({ entityType: 'Partner', entityId: p.id, action: 'partner.updated', before: partnerDto(before), after: partnerDto(p) });
      return { status: 200, body: partnerDto(p) };
    });
    return reply;
  });

  app.post('/partners/:id/users', { config: { access: ADMIN }, schema: { tags: ['supply'], params: IdParams, body: PartnerUserInput } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await tx.partner.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!p) throw notFound('Partner not found');
      const email = req.body.email.toLowerCase();
      if ((await tx.partnerUser.findUnique({ where: { email } })) || (await tx.user.findUnique({ where: { email } }))) throw new AppError(409, 'EMAIL_IN_USE', 'This email already has an account.');
      const temporaryPassword = req.body.password ? undefined : generateTemporaryPassword();
      const u = await tx.partnerUser.create({ data: { clientId: p.clientId, partnerId: p.id, email, name: req.body.name, passwordHash: await hashPassword(req.body.password ?? temporaryPassword!), mustChangePassword: req.body.requirePasswordChange } });
      await audit({ entityType: 'PartnerUser', entityId: u.id, action: 'partner.user_created', after: { partnerId: p.id, email } });
      const body = { id: u.id, email: u.email, name: u.name, status: u.status, mustChangePassword: u.mustChangePassword };
      // The temporary password is shown once; a replay never returns it.
      return { status: 201, body: { ...body, temporaryPassword }, replayBody: body };
    });
    return reply;
  });

  const UserParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
  async function portalUser(tx: Tx, clientId: string, partnerId: string, userId: string) {
    const u = await tx.partnerUser.findFirst({ where: { id: userId, partnerId, clientId } });
    if (!u) throw notFound('Portal user not found');
    return u;
  }

  // A new temporary password for a portal user; their sessions end at once.
  app.post('/partners/:id/users/:userId/password-reset', { config: { access: ADMIN }, schema: { tags: ['supply'], params: UserParams } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const u = await portalUser(tx, actor.clientId, req.params.id, req.params.userId);
      const temporaryPassword = generateTemporaryPassword();
      await tx.partnerUser.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true } });
      await tx.session.updateMany({ where: { partnerUserId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit({ entityType: 'PartnerUser', entityId: u.id, action: 'partner.user_password_reset', after: { mustChangePassword: true } });
      const body = { id: u.id, email: u.email, name: u.name, status: u.status, mustChangePassword: true };
      return { status: 200, body: { ...body, temporaryPassword }, replayBody: body };
    });
    return reply;
  });

  // Disable or re-enable one portal user (disabling ends their sessions) without suspending the whole partner.
  app.patch('/partners/:id/users/:userId/status', { config: { access: ADMIN }, schema: { tags: ['supply'], params: UserParams, body: z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const u = await portalUser(tx, actor.clientId, req.params.id, req.params.userId);
      const updated = await tx.partnerUser.update({ where: { id: u.id }, data: { status: req.body.status } });
      if (req.body.status === 'DISABLED') await tx.session.updateMany({ where: { partnerUserId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit({ entityType: 'PartnerUser', entityId: u.id, action: 'partner.user_status_changed', before: { status: u.status }, after: { status: updated.status } });
      return { status: 200, body: { id: updated.id, email: updated.email, name: updated.name, status: updated.status, mustChangePassword: updated.mustChangePassword } };
    });
    return reply;
  });

  // ── Requisitions ──
  app.get('/requisitions', { config: { access: SEE }, schema: { tags: ['supply'], querystring: z.object({ projectId: z.string().uuid().optional(), state: z.enum(REQUISITION_STATES).optional() }) } }, async (req) => {
    const a = req.actor!;
    const rows = await db.requisition.findMany({
      where: { clientId: a.clientId, ...(req.query.projectId ? { projectId: req.query.projectId } : {}), ...(req.query.state ? { state: req.query.state } : {}), ...(a.roles.includes('ADMIN') || a.roles.includes('REVIEWER') ? {} : { project: { ownerId: a.userId } }) },
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } }, _count: { select: { submissions: true } } },
    });
    return { items: rows.map((r) => requisitionDto(r, { projectName: r.project.name, submissions: r._count.submissions })) };
  });

  app.get('/requisitions/:id', { config: { access: SEE }, schema: { tags: ['supply'], params: IdParams } }, async (req) => {
    const r = await loadRequisition(db, req.params.id, req.actor!);
    const counts = await db.partnerSubmission.groupBy({ by: ['state'], where: { requisitionId: r.id, sandbox: false }, _count: true });
    return requisitionDto(r, { projectName: r.project.name, counts: Object.fromEntries(counts.map((c) => [c.state, c._count])) });
  });

  app.post('/requisitions', { config: { access: PLAN }, schema: { tags: ['supply'], body: RequisitionInput } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => ({ status: 201, body: requisitionDto(await createRequisition(tx, actor, req.body, audit)) }));
    return reply;
  });

  app.put('/requisitions/:id', { config: { access: PLAN }, schema: { tags: ['supply'], params: IdParams, body: RequisitionInput } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => ({ status: 200, body: requisitionDto(await updateRequisition(tx, actor, req.params.id, req.body, audit)) }));
    return reply;
  });

  app.post('/requisitions/:id/transition', { config: { access: PLAN }, schema: { tags: ['supply'], params: IdParams, body: z.object({ to: z.enum(REQUISITION_STATES) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => ({ status: 200, body: requisitionDto(await transitionRequisition(tx, actor, req.params.id, req.body.to, audit)) }));
    return reply;
  });

  // ── Submissions and the requirement screen ──
  app.get('/requisitions/:id/submissions', { config: { access: SEE }, schema: { tags: ['supply'], params: IdParams } }, async (req) => {
    const r = await loadRequisition(db, req.params.id, req.actor!);
    const rows = await db.partnerSubmission.findMany({ where: { requisitionId: r.id, sandbox: false }, include: { candidate: true, partner: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } });
    return {
      items: rows.map((s) => ({
        id: s.id,
        name: s.candidate.name,
        email: s.candidate.emailNorm,
        country: s.candidate.country,
        partner: s.partner,
        channel: s.channel,
        state: s.state,
        screen: s.screen,
        screenReasons: s.screenReasons,
        duplicateReason: s.duplicateReason,
        inviteAccepted: !!s.inviteAcceptedAt,
        submittedAt: s.createdAt.toISOString(),
      })),
    };
  });

  app.get('/partner-submissions/:id', { config: { access: SEE }, schema: { tags: ['supply'], params: IdParams } }, async (req) => {
    const s = await db.partnerSubmission.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId }, include: { candidate: true, partner: { select: { id: true, name: true } } } });
    if (!s) throw notFound('Submission not found');
    return { ...(await candidateView(db, s)), name: s.candidate.name, email: s.candidate.emailNorm, partner: s.partner, details: s.details, screenReasons: s.screenReasons };
  });

  // Only a person confirms "requirements not met"; bulk confirmation is allowed (section 2).
  app.post(
    '/partner-submissions/screen-decisions',
    { config: { access: VALIDATE }, schema: { tags: ['supply'], body: z.object({ submissionIds: z.array(z.string().uuid()).min(1).max(200), decision: z.enum(['CONFIRM_NOT_MET', 'MEETS']), note: z.string().trim().min(3).max(1000) }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const out = await decideScreen(tx, actor.clientId, req.body.submissionIds, req.body.decision, req.body.note, actor.userId, audit);
        return { status: 200, body: { items: out.map((s) => ({ id: s.id, screen: s.screen, state: s.state })) } };
      });
      return reply;
    },
  );
};
