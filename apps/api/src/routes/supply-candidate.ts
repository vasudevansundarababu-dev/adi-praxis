import { TIER_LABELS } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError, notFound } from '../lib/errors';
import { runCandidateCommand } from '../platform/command';
import { opportunityForTier, redeemInvite, submitCandidate } from '../supply/submissions';
import { startOrResumeEnrollment } from './opportunities';

const IdParams = z.object({ id: z.string().uuid() });

/**
 * M10 candidate routes: follow a partner's invitation into FLOW 2, and apply directly on a requisition's careers page.
 * Both lead into the unchanged FLOW 2 journey (profile, human selection, onboarding).
 */
export const supplyCandidateRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  app.post('/me/partner-invites/redeem', { config: { access: 'candidate', rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['supply'], body: z.object({ token: z.string().min(20).max(200) }) } }, async (req, reply) => {
    await runCandidateCommand<Record<string, unknown>>(db, req, reply, async ({ tx, actor, audit }) => {
      const r = await redeemInvite(tx, actor.smeUserId, req.body.token, audit, (opportunityId) => startOrResumeEnrollment(tx, { clientId: actor.clientId, smeUserId: actor.smeUserId, opportunityId, requireLiveIdentity: config.requireLiveIdentity }, audit));
      if (r.duplicate) return { status: 409, body: { error: 'ALREADY_REGISTERED', message: 'You are already registered with ADI Praxis through another submission. Continue from your home page.' } };
      return { status: 200, body: { enrollmentId: r.enrollmentId, opportunityId: r.opportunityId } };
    });
    return reply;
  });

  // Direct careers page: public details of an open requisition that allows direct applications.
  app.get('/careers/requisitions/:id', { config: { access: 'public' }, schema: { tags: ['supply'], params: IdParams } }, async (req) => {
    const r = await db.requisition.findFirst({ where: { id: req.params.id, state: 'OPEN', directChannel: true } });
    if (!r) throw notFound('This role is not open for applications.');
    return { id: r.id, title: r.title, summary: r.summary, domain: r.domain, tier: r.tier, tierLabel: TIER_LABELS[r.tier], hoursPerWeek: r.hoursPerWeek, durationWeeks: r.durationWeeks, startDate: r.startDate?.toISOString().slice(0, 10) ?? null, languages: r.languages, jurisdictions: r.jurisdictions, minimumRequirements: r.minimumRequirements };
  });

  app.post(
    '/me/requisitions/:id/apply',
    {
      config: { access: 'candidate' },
      schema: {
        tags: ['supply'],
        params: IdParams,
        body: z.object({ experienceSummary: z.string().trim().min(10).max(4000), experienceYears: z.number().min(0).max(60), qualifications: z.array(z.string().trim().min(1).max(200)).max(30).default([]), languages: z.array(z.string().trim().min(2).max(20)).max(20).default([]), country: z.string().trim().length(2).toUpperCase(), phone: z.string().trim().max(40).optional(), consent: z.literal(true) }),
      },
    },
    async (req, reply) => {
      await runCandidateCommand<Record<string, unknown>>(db, req, reply, async ({ tx, actor, audit }) => {
        const u = await tx.smeUser.findUniqueOrThrow({ where: { id: actor.smeUserId } });
        const email = u.contactEmail;
        if (!email) throw new AppError(409, 'NO_EMAIL', 'Your account has no email address.');
        const res = await submitCandidate(
          tx,
          { email: null, appUrl: config.CANDIDATE_APP_URL },
          {
            clientId: actor.clientId,
            ch: { partnerId: null, sandbox: false, channel: 'DIRECT' },
            requisitionId: req.params.id,
            smeUserId: actor.smeUserId,
            input: { name: u.displayName ?? email, email, phone: req.body.phone, country: req.body.country, experienceSummary: req.body.experienceSummary, experienceYears: req.body.experienceYears, employmentHistory: [], qualifications: req.body.qualifications, languages: req.body.languages, partnerTrainingAttestation: true, candidateConsent: true },
          },
          audit,
        );
        if (res.status !== 201) return { status: 409, body: { error: 'ALREADY_REGISTERED', message: 'You already have an application in progress for this role, or applied recently.' } };
        const r = await tx.requisition.findUniqueOrThrow({ where: { id: req.params.id }, include: { project: { include: { opportunities: true } } } });
        const opp = opportunityForTier(r.project.opportunities, r.tier);
        if (!opp || opp.status !== 'PUBLISHED') throw new AppError(409, 'OPPORTUNITY_NOT_OPEN', 'This role is not open for profiles yet.');
        const e = await startOrResumeEnrollment(tx, { clientId: actor.clientId, smeUserId: actor.smeUserId, opportunityId: opp.id, requireLiveIdentity: config.requireLiveIdentity }, audit);
        await tx.partnerSubmission.update({ where: { id: (res.body as { candidateId: string }).candidateId }, data: { enrollmentId: e.id } });
        return { status: 200, body: { enrollmentId: e.id, opportunityId: opp.id } };
      });
      return reply;
    },
  );
};
