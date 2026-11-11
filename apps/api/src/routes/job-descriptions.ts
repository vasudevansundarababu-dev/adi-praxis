import type { JobDescription } from '@prisma/client';
import { CreateJobDescriptionRequest, JdProfileLine, JobDescriptionDto, UpdateJobDescriptionRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { AppError, badRequest, notFound } from '../lib/errors';
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
  role: jd.role,
  generated: jd.generated,
  projectId: jd.projectId,
  mandatorySkills: jd.mandatorySkills,
  minExperienceYears: jd.minExperienceYears,
  educationLevel: jd.educationLevel,
  demographicProfile: JdProfileLine.array().catch([]).parse(jd.demographicProfile),
});

/** The template's spelling of each mandatory skill first, then the PM's other skills (case-insensitive de-duplication). */
function keepMandatory(mandatory: string[], skills: string[]): string[] {
  const seen = new Set(mandatory.map((m) => m.trim().toLowerCase()));
  const extra = skills.map((x) => x.trim()).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
  return [...mandatory, ...extra];
}

const IdParams = z.object({ id: z.string().uuid() });
const ACCESS = ['PM', 'ADMIN'] as const;

/** Job descriptions, reusable across projects (SPEC: GET/POST /job-descriptions, GET/PATCH /job-descriptions/{id}). */
export const jobDescriptionRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/job-descriptions',
    { config: { access: ACCESS }, schema: { tags: ['job-descriptions'], response: { 200: z.object({ items: z.array(JobDescriptionDto) }) } } },
    async (req) => {
      // Generated JDs belong to one project (GET /projects/:id/job-descriptions); the shared list is for reuse.
      const items = await db.jobDescription.findMany({ where: { clientId: req.actor!.clientId, generated: false }, orderBy: { title: 'asc' } });
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
        if (req.body.skills && before.mandatorySkills.length) {
          const have = new Set(req.body.skills.map((x) => x.trim().toLowerCase()));
          const missing = before.mandatorySkills.filter((m) => !have.has(m.trim().toLowerCase()));
          if (missing.length) throw new AppError(400, 'MANDATORY_SKILLS_REQUIRED', `These skills come from the template and cannot be removed: ${missing.join(', ')}.`);
        }
        if (merged.locationType !== 'REMOTE' && !merged.location?.trim()) {
          throw badRequest('Location is required for onsite and hybrid roles');
        }
        // Submitted projects keep their own JD snapshot, so editing a shared JD never changes them.
        const jd = await tx.jobDescription.update({
          where: { id: before.id },
          data: {
            ...req.body,
            ...(req.body.title ? { normalizedTitle: normalizeTitle(req.body.title) } : {}),
            ...(req.body.skills ? { skills: keepMandatory(before.mandatorySkills, req.body.skills) } : {}),
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
