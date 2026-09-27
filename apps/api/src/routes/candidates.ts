import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { notFound } from '../lib/errors';

const CandidateDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  identityVerified: z.boolean(),
  specialties: z.array(z.string()),
  skills: z.array(z.string()),
  jurisdictions: z.array(z.string()),
  country: z.string().nullable(),
  city: z.string().nullable(),
  languages: z.array(z.object({ language: z.string(), level: z.string() })),
  domainExperienceYears: z.number().nullable(),
  educationLevel: z.string().nullable(),
  hoursPerWeek: z.number().int().nullable(),
  timezone: z.string().nullable(),
  lastValidatedAt: z.string().nullable(),
  activeProjects: z.number().int(),
  concurrentProjectLimit: z.number().int(),
});

/**
 * Read-only matching record for "View profile" on the Resource Assignment screen. Only matching fields; identity
 * documents, evidence and conversation transcripts are never exposed here (FLOW2-SME section 9).
 */
export const candidateRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/candidates/:id',
    { config: { access: ['PM', 'ADMIN'] }, schema: { tags: ['staffing'], params: z.object({ id: z.string().uuid() }), response: { 200: CandidateDto } } },
    async (req) => {
      const c = await db.candidate.findFirst({
        where: { id: req.params.id, clientId: req.actor!.clientId, deletedAt: null },
        include: { smeUser: { select: { displayName: true, identityStatus: true } } },
      });
      if (!c) throw notFound('Candidate not found');
      const activeProjects = await db.projectAssignment.count({
        where: { candidateId: c.id, releasedAt: null, project: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
      });
      return {
        id: c.id,
        name: c.smeUser.displayName ?? 'Unnamed candidate',
        identityVerified: c.smeUser.identityStatus === 'VERIFIED' || c.smeUser.identityStatus === 'ALTERNATIVE_VERIFIED',
        specialties: c.specialties,
        skills: c.skills,
        jurisdictions: c.jurisdictions,
        country: c.country,
        city: c.city,
        languages: c.languages as { language: string; level: string }[],
        domainExperienceYears: c.domainExperienceYears,
        educationLevel: c.educationLevel,
        hoursPerWeek: c.hoursPerWeek,
        timezone: c.timezone,
        lastValidatedAt: c.lastValidatedAt?.toISOString() ?? null,
        activeProjects,
        concurrentProjectLimit: c.concurrentProjectLimit,
      };
    },
  );
};
