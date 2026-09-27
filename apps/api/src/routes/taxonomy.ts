import type { DemographicAttribute, Prisma } from '@prisma/client';
import { CreateDemographicAttributeRequest, DemographicAttributeDto } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { conflict } from '../lib/errors';
import { runCommand } from '../platform/command';

export const toAttributeDto = (a: DemographicAttribute): z.infer<typeof DemographicAttributeDto> => ({
  id: a.id,
  key: a.key,
  label: a.label,
  type: a.type,
  allowedValues: a.allowedValues,
});

/**
 * Admin-managed demographic taxonomy (SPEC: GET/POST /demographic-attributes). PMs may read it, because the
 * FLOW 1 wizard's demographics step is built from it.
 */
export const taxonomyRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/demographic-attributes',
    {
      config: { access: ['ADMIN', 'PM'] },
      schema: { tags: ['taxonomy'], response: { 200: z.object({ items: z.array(DemographicAttributeDto) }) } },
    },
    async (req) => {
      const items = await db.demographicAttribute.findMany({ where: { clientId: req.actor!.clientId }, orderBy: { createdAt: 'asc' } });
      return { items: items.map(toAttributeDto) };
    },
  );

  app.post(
    '/demographic-attributes',
    {
      config: { access: ['ADMIN'] },
      schema: { tags: ['taxonomy'], body: CreateDemographicAttributeRequest, response: { 201: DemographicAttributeDto } },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const clash = await tx.demographicAttribute.findUnique({ where: { clientId_key: { clientId: actor.clientId, key: req.body.key } } });
        if (clash) throw conflict(`An attribute with key "${req.body.key}" already exists`);
        const a = await tx.demographicAttribute.create({
          data: {
            clientId: actor.clientId,
            key: req.body.key,
            label: req.body.label,
            type: req.body.type,
            allowedValues: req.body.allowedValues as Prisma.InputJsonValue,
          },
        });
        const body = toAttributeDto(a);
        await audit({ entityType: 'DemographicAttribute', entityId: a.id, action: 'demographic_attribute.created', after: { key: a.key, label: a.label, type: a.type } });
        return { status: 201, body };
      });
      return reply;
    },
  );
};
