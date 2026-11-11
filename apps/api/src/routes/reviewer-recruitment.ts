import { identityEligible } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import type { Db } from '../db';
import { AppError, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { loadProject } from './projects';

/**
 * Reviewer job post (owner, 12 Nov 2026). Applicants to a project's reviewer post go through the usual candidate flow:
 * profile, identity and a human selection decision. A SELECTED applicant then becomes the project's Expert: a staff
 * user with the Validator (REVIEWER) role, assigned to the project. Creating a staff account or adding a role stays an
 * Admin action, as for /users; a PM can assign an applicant who already holds an active Validator account.
 */
const IdParams = z.object({ id: z.string().uuid() });
const ACCESS = ['PM', 'ADMIN'] as const;

const Applicant = z.object({
  enrollmentId: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  status: z.string(),
  identityVerified: z.boolean(),
  expertUserId: z.string().uuid().nullable(),
});

export const reviewerRecruitmentRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/projects/:id/reviewer-applicants',
    { config: { access: ACCESS }, schema: { tags: ['opportunities'], params: IdParams, response: { 200: z.object({ items: z.array(Applicant) }) } } },
    async (req) => {
      const p = await loadProject(db, req.params.id, req.actor!);
      const list = await db.enrollment.findMany({
        where: { opportunity: { projectId: p.id, role: 'REVIEWER' }, status: { not: 'DRAFT' } },
        include: { smeUser: true },
        orderBy: { submittedAt: 'asc' },
      });
      const emails = list.map((e) => e.smeUser.contactEmail?.toLowerCase()).filter((x): x is string => !!x);
      const experts = await db.projectReviewer.findMany({ where: { projectId: p.id, user: { email: { in: emails, mode: 'insensitive' } } }, include: { user: true } });
      return {
        items: list.map((e) => ({
          enrollmentId: e.id,
          name: e.smeUser.displayName ?? 'Applicant',
          email: e.smeUser.contactEmail,
          status: e.status,
          identityVerified: identityEligible(e.smeUser.identityStatus),
          expertUserId: experts.find((x) => x.user.email.toLowerCase() === e.smeUser.contactEmail?.toLowerCase())?.userId ?? null,
        })),
      };
    },
  );

  app.post(
    '/projects/:id/reviewer-applicants/:enrollmentId/make-expert',
    {
      config: { access: ACCESS },
      schema: {
        tags: ['opportunities'],
        params: IdParams.extend({ enrollmentId: z.string().uuid() }),
        response: { 200: z.object({ userId: z.string().uuid(), created: z.boolean(), temporaryPassword: z.string().optional() }) },
      },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        if (p.reviewRoute !== 'SME_EXPERT_PM') throw new AppError(409, 'NO_EXPERT_ROUTE', 'This project does not use the SME → Expert → PM review route.');
        const e = await tx.enrollment.findFirst({
          where: { id: req.params.enrollmentId, opportunity: { projectId: p.id, role: 'REVIEWER' } },
          include: { smeUser: true },
        });
        if (!e) throw notFound('Reviewer applicant not found');
        // A human selection decision comes first (AI never selects); identity must be verified.
        if (e.status !== 'SELECTED') throw new AppError(409, 'NOT_SELECTED', 'Only a selected applicant can become the project’s Expert. Make the selection decision first.');
        if (!identityEligible(e.smeUser.identityStatus)) throw new AppError(409, 'IDENTITY_NOT_VERIFIED', 'The applicant’s identity is not verified yet.');
        const email = e.smeUser.contactEmail?.trim().toLowerCase();
        if (!email) throw new AppError(409, 'NO_EMAIL', 'The applicant has no contact email, so no Validator account can be set up.');

        const isAdmin = actor.roles.includes('ADMIN');
        let user = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        let created = false;
        let temporaryPassword: string | undefined;
        if (user && user.clientId !== p.clientId) throw new AppError(409, 'EMAIL_IN_USE', 'This email belongs to an account outside this client.');
        if (user && user.status !== 'ACTIVE') throw new AppError(409, 'ACCOUNT_DISABLED', 'The applicant’s staff account is disabled. Ask an Admin to re-enable it.');
        if (!user) {
          if (!isAdmin) throw new AppError(403, 'ASK_ADMIN', 'The applicant has no Validator account yet. An Admin can create it from here.');
          temporaryPassword = generateTemporaryPassword();
          user = await tx.user.create({
            data: { clientId: p.clientId, email, name: e.smeUser.displayName ?? email, roles: ['REVIEWER'], passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
          });
          created = true;
          await audit({ entityType: 'User', entityId: user.id, action: 'user.created', after: { email, roles: ['REVIEWER'], fromEnrollmentId: e.id } });
        } else if (!user.roles.includes('REVIEWER')) {
          if (!isAdmin) throw new AppError(403, 'ASK_ADMIN', 'The applicant’s account does not have the Validator role. An Admin can add it from here.');
          const before = user.roles;
          user = await tx.user.update({ where: { id: user.id }, data: { roles: [...before, 'REVIEWER'] } });
          await audit({ entityType: 'User', entityId: user.id, action: 'user.roles_changed', before: { roles: before }, after: { roles: user.roles, fromEnrollmentId: e.id } });
        }
        const existing = await tx.projectReviewer.findUnique({ where: { projectId_userId: { projectId: p.id, userId: user.id } } });
        if (!existing) {
          await tx.projectReviewer.create({ data: { clientId: p.clientId, projectId: p.id, userId: user.id, assignedById: actor.userId } });
          await audit({ entityType: 'Project', entityId: p.id, action: 'project.reviewer_assigned', after: { userId: user.id, fromEnrollmentId: e.id } });
        }
        // The password is shown once; a replay never repeats it.
        return { status: 200, body: { userId: user.id, created, ...(temporaryPassword ? { temporaryPassword } : {}) }, replayBody: { userId: user.id, created } };
      });
      return reply;
    },
  );
};
