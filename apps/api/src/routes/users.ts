import type { User } from '@prisma/client';
import { CreateUserRequest, InternalUserDto, UpdateUserRolesRequest, UpdateUserStatusRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { hashPassword } from '../auth/password';
import { revokeAllUserSessions } from '../auth/sessions';
import type { Db } from '../db';
import { conflict, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';

export const toUserDto = (u: User): z.infer<typeof InternalUserDto> => ({
  id: u.id,
  email: u.email,
  name: u.name,
  roles: u.roles,
  status: u.status,
  clientId: u.clientId,
});

const IdParams = z.object({ id: z.string().uuid() });
const ADMIN = ['ADMIN'] as const;

/** Admin: manage internal users and roles (SPEC: Personas and roles). */
export const userRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/users',
    {
      config: { access: ADMIN },
      schema: { tags: ['users'], response: { 200: z.object({ items: z.array(InternalUserDto) }) } },
    },
    async (req) => {
      const users = await db.user.findMany({ where: { clientId: req.actor!.clientId }, orderBy: { email: 'asc' } });
      return { items: users.map(toUserDto) };
    },
  );

  app.post(
    '/users',
    {
      config: { access: ADMIN },
      schema: { tags: ['users'], body: CreateUserRequest, response: { 201: InternalUserDto } },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
        const existing = await tx.user.findUnique({ where: { email: req.body.email } });
        if (existing) throw conflict('A user with this email already exists');
        const user = await tx.user.create({
          data: {
            clientId: actor.clientId,
            email: req.body.email,
            name: req.body.name,
            roles: req.body.roles,
            passwordHash: await hashPassword(req.body.password),
          },
        });
        const after = toUserDto(user);
        await audit({ entityType: 'User', entityId: user.id, action: 'user.created', after });
        await emit({ name: 'user.created', aggregateType: 'User', aggregateId: user.id, payload: { userId: user.id } });
        return { status: 201, body: after };
      });
      return reply;
    },
  );

  app.patch(
    '/users/:id/roles',
    {
      config: { access: ADMIN },
      schema: { tags: ['users'], params: IdParams, body: UpdateUserRolesRequest, response: { 200: InternalUserDto } },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
        const before = await tx.user.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
        if (!before) throw notFound('User not found');
        const roles = [...new Set(req.body.roles)];
        const user = await tx.user.update({ where: { id: before.id }, data: { roles } });
        await audit({
          entityType: 'User',
          entityId: user.id,
          action: 'user.roles_changed',
          before: { roles: before.roles },
          after: { roles: user.roles },
        });
        await emit({
          name: 'user.roles_changed',
          aggregateType: 'User',
          aggregateId: user.id,
          payload: { userId: user.id, roles: user.roles },
        });
        return { status: 200, body: toUserDto(user) };
      });
      return reply;
    },
  );

  app.patch(
    '/users/:id/status',
    {
      config: { access: ADMIN },
      schema: { tags: ['users'], params: IdParams, body: UpdateUserStatusRequest, response: { 200: InternalUserDto } },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
        const before = await tx.user.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
        if (!before) throw notFound('User not found');
        if (before.id === actor.userId && req.body.status === 'DISABLED') {
          throw conflict('You cannot disable your own account');
        }
        const user = await tx.user.update({ where: { id: before.id }, data: { status: req.body.status } });
        await audit({
          entityType: 'User',
          entityId: user.id,
          action: 'user.status_changed',
          before: { status: before.status },
          after: { status: user.status },
        });
        await emit({
          name: 'user.status_changed',
          aggregateType: 'User',
          aggregateId: user.id,
          payload: { userId: user.id, status: user.status },
        });
        return { status: 200, body: toUserDto(user) };
      });
      // Disabling signs the user out everywhere.
      if (req.body.status === 'DISABLED') await revokeAllUserSessions(db, req.params.id);
      return reply;
    },
  );
};
