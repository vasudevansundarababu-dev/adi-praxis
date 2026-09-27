import type { JobDescription } from '@prisma/client';
import { CreateJobDescriptionRequest, JobDescriptionDto, UpdateJobDescriptionRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { badRequest, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';

/** Lower-cased, whitespace-collapsed title used by FLOW 2's JD lookup. */
export const normalizeTitle = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ');

export const toJdDto = (jd: JobDescription): JobDescriptionDto => ({
  id: jd.id,
  title: jd.title,
  responsibilities: jd.responsibilities,
  skills: jd.skills,
  wagePerTask: Number(jd.wagePerTask),
  wageCurrency: jd.wageCurrency,
  locationType: jd.locationType,
  location: jd.location,
  updatedAt: jd.updatedAt.toISOString(),
});

const IdParams = z.object({ id: z.string().uuid() });
const ACCESS = ['PM', 'ADMIN'] as const;

/** Job descriptions, reusable across projects (SPEC: GET/POST /job-descriptions, GET/PATCH /job-descriptions/{id}). */
export const jobDescriptionRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/job-descriptions',
    { config: { access: ACCESS }, schema: { tags: ['job-descriptions'], response: { 200: z.object({ items: z.array(JobDescriptionDto) }) } } },
    async (req) => {
      const items = await db.jobDescription.findMany({ where: { clientId: req.actor!.clientId }, orderBy: { title: 'asc' } });
      return { items: items.map(toJdDto) };
    },
  );

  app.get(
    '/job-descriptions/:id',
    { config: { access: ACCESS }, schema: { tags: ['job-descriptions'], params: IdParams, response: { 200: JobDescriptionDto } } },
    async (req) => {
      const jd = await db.jobDescription.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId } });
      if (!jd) throw notFound('Job description not found');
      return toJdDto(jd);
    },
  );

  app.post(
    '/job-descriptions',
    { config: { access: ACCESS }, schema: { tags: ['job-descriptions'], body: CreateJobDescriptionRequest, response: { 201: JobDescriptionDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const jd = await tx.jobDescription.create({
          data: {
            ...req.body,
            location: req.body.locationType === 'REMOTE' ? (req.body.location ?? null) : req.body.location!,
            clientId: actor.clientId,
            normalizedTitle: normalizeTitle(req.body.title),
            skills: [...new Set(req.body.skills)],
          },
        });
        const body = toJdDto(jd);
        await audit({ entityType: 'JobDescription', entityId: jd.id, action: 'job_description.created', after: body });
        return { status: 201, body };
      });
      return reply;
    },
  );

  app.patch(
    '/job-descriptions/:id',
    {
      config: { access: ACCESS },
      schema: { tags: ['job-descriptions'], params: IdParams, body: UpdateJobDescriptionRequest, response: { 200: JobDescriptionDto } },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const before = await tx.jobDescription.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
        if (!before) throw notFound('Job description not found');
        const merged = { ...toJdDto(before), ...req.body };
        if (merged.locationType !== 'REMOTE' && !merged.location?.trim()) {
          throw badRequest('Location is required for onsite and hybrid roles');
        }
        // Submitted projects keep their own JD snapshot, so editing a shared JD never changes them.
        const jd = await tx.jobDescription.update({
          where: { id: before.id },
          data: {
            ...req.body,
            ...(req.body.title ? { normalizedTitle: normalizeTitle(req.body.title) } : {}),
            ...(req.body.skills ? { skills: [...new Set(req.body.skills)] } : {}),
          },
        });
        const changed = Object.keys(req.body) as (keyof JobDescriptionDto)[];
        const pick = (d: JobDescriptionDto) => Object.fromEntries(changed.map((k) => [k, d[k]]));
        await audit({ entityType: 'JobDescription', entityId: jd.id, action: 'job_description.updated', before: pick(toJdDto(before)), after: pick(toJdDto(jd)) });
        return { status: 200, body: toJdDto(jd) };
      });
      return reply;
    },
  );
};
