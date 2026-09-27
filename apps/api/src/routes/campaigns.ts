import type { Campaign } from '@prisma/client';
import { CampaignDto } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Actor } from '../auth/actor';
import { LinkedInApplyConnectAdapter, ManualAdapter, type JobBoardAdapter } from '../candidate/job-board';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { loadProject } from './projects';

const ACTIVE = ['LIVE', 'PAUSED'] as const;
type Channel = 'LINKEDIN_MANUAL' | 'LINKEDIN_APPLY_CONNECT';
const ADAPTERS: Record<Channel, JobBoardAdapter> = {
  LINKEDIN_MANUAL: new ManualAdapter(),
  LINKEDIN_APPLY_CONNECT: new LinkedInApplyConnectAdapter(),
};

const INSTRUCTIONS: Record<string, string> = {
  LINKEDIN_MANUAL:
    'Post this on LinkedIn as a job. Under "How candidates apply", choose "Apply on company website" and paste the apply link. Applicants are counted automatically.',
  LINKEDIN_APPLY_CONNECT: 'Posted through LinkedIn Apply Connect.',
};

export const applyUrlFor = (config: Config, campaignId: string) => `${config.CANDIDATE_APP_URL}/apply/${campaignId}`;

/** Campaign funnel: clicks (tracked link), applies, identity completed, approved, assigned. */
export async function campaignDto(tx: Db | Tx, c: Campaign): Promise<CampaignDto> {
  const apps = await tx.application.findMany({
    where: { campaignId: c.id },
    include: { enrollment: { include: { smeUser: { include: { candidate: { include: { assignments: { where: { projectId: c.projectId, releasedAt: null } } } } } } } } },
  });
  const users = apps.map((a) => a.enrollment?.smeUser).filter((u): u is NonNullable<typeof u> => !!u);
  return {
    id: c.id,
    projectId: c.projectId,
    channel: c.channel,
    status: c.status,
    postText: c.postText,
    applyUrl: c.applyUrl,
    instructions: INSTRUCTIONS[c.channel]!,
    startAt: c.startAt?.toISOString() ?? null,
    endAt: c.endAt?.toISOString() ?? null,
    metrics: {
      clicks: c.clicks,
      applies: apps.length,
      kycCompleted: users.filter((u) => u.identityStatus === 'VERIFIED' || u.identityStatus === 'ALTERNATIVE_VERIFIED').length,
      approved: apps.filter((a) => a.enrollment?.status === 'SELECTED').length,
      assigned: users.filter((u) => (u.candidate?.assignments.length ?? 0) > 0).length,
    },
  };
}

/** Launches a campaign for a staffing project with a published opportunity. Shared by the API and auto-launch. */
export async function launchCampaign(tx: Tx, config: Config, projectId: string, channel: Channel) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: { jobDescription: true, opportunity: true } });
  if (p.status !== 'STAFFING') throw new AppError(409, 'NOT_STAFFING', 'Campaigns can be launched while a project is staffing.');
  if (p.opportunity?.status !== 'PUBLISHED') throw new AppError(409, 'OPPORTUNITY_NOT_PUBLISHED', 'Publish the project’s opportunity page first; the apply link points to it.');
  if (!p.jobDescription) throw new AppError(409, 'NO_JOB_DESCRIPTION', 'The project has no job description.');
  const active = await tx.campaign.findFirst({ where: { projectId, status: { in: [...ACTIVE] } } });
  if (active) throw new AppError(409, 'CAMPAIGN_ACTIVE', 'This project already has an active campaign.');

  const adapter = ADAPTERS[channel]!;
  const draft = await tx.campaign.create({
    data: { clientId: p.clientId, projectId, jobDescriptionId: p.jobDescription.id, channel, status: 'DRAFT' },
  });
  const brief = (await tx.opportunityVersion.findFirst({ where: { opportunityId: p.opportunity.id }, orderBy: { version: 'desc' } }))!.brief as { summary?: string };
  const applyUrl = applyUrlFor(config, draft.id);
  const jd = p.jobDescription;
  const published = await adapter.publish({
    title: jd.title,
    summary: brief.summary ?? '',
    responsibilities: jd.responsibilities,
    skills: jd.skills,
    wagePerTask: Number(jd.wagePerTask),
    wageCurrency: jd.wageCurrency,
    locationType: jd.locationType,
    location: jd.location,
    applyUrl,
  });
  return tx.campaign.update({
    where: { id: draft.id },
    data: { status: 'LIVE', postText: published.postText, applyUrl, externalId: published.externalId, startAt: new Date() },
  });
}

const IdParams = z.object({ id: z.string().uuid() });
const ACCESS = ['PM', 'ADMIN'] as const;

/** SPEC FLOW 2 sourcing: LinkedIn job campaign (ManualAdapter in v1). */
export const campaignRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  const loadCampaign = async (tx: Db | Tx, id: string, actor: Actor) => {
    const c = await tx.campaign.findFirst({ where: { id, clientId: actor.clientId } });
    if (!c) throw notFound('Campaign not found');
    await loadProject(tx, c.projectId, actor); // owner-or-Admin check
    return c;
  };

  app.get(
    '/projects/:id/campaigns',
    { config: { access: ACCESS }, schema: { tags: ['campaigns'], params: IdParams, response: { 200: z.object({ items: z.array(CampaignDto) }) } } },
    async (req) => {
      const p = await loadProject(db, req.params.id, req.actor!);
      const list = await db.campaign.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' } });
      return { items: await Promise.all(list.map((c) => campaignDto(db, c))) };
    },
  );

  app.post(
    '/projects/:id/campaigns',
    {
      config: { access: ACCESS },
      schema: { tags: ['campaigns'], params: IdParams, body: z.object({ channel: z.enum(['LINKEDIN_MANUAL', 'LINKEDIN_APPLY_CONNECT']).default('LINKEDIN_MANUAL') }), response: { 201: CampaignDto } },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        const c = await launchCampaign(tx, config, p.id, req.body.channel);
        await audit({ entityType: 'Campaign', entityId: c.id, action: 'campaign.launched', after: { projectId: p.id, channel: c.channel, status: 'LIVE' } });
        return { status: 201, body: await campaignDto(tx, c) };
      });
      return reply;
    },
  );

  app.get('/campaigns/:id', { config: { access: ACCESS }, schema: { tags: ['campaigns'], params: IdParams, response: { 200: CampaignDto } } }, async (req) =>
    campaignDto(db, await loadCampaign(db, req.params.id, req.actor!)),
  );

  app.patch(
    '/campaigns/:id',
    { config: { access: ACCESS }, schema: { tags: ['campaigns'], params: IdParams, body: z.object({ status: z.enum(['LIVE', 'PAUSED']) }), response: { 200: CampaignDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const c = await loadCampaign(tx, req.params.id, actor);
        if (!(ACTIVE as readonly string[]).includes(c.status)) throw new AppError(409, 'CAMPAIGN_CLOSED', 'Closed campaigns cannot be changed.');
        const u = await tx.campaign.update({ where: { id: c.id }, data: { status: req.body.status } });
        await audit({ entityType: 'Campaign', entityId: c.id, action: req.body.status === 'PAUSED' ? 'campaign.paused' : 'campaign.resumed', before: { status: c.status }, after: { status: u.status } });
        return { status: 200, body: await campaignDto(tx, u) };
      });
      return reply;
    },
  );

  app.post('/campaigns/:id/close', { config: { access: ACCESS }, schema: { tags: ['campaigns'], params: IdParams, response: { 200: CampaignDto } } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const c = await loadCampaign(tx, req.params.id, actor);
      if (c.status === 'CLOSED') throw new AppError(409, 'CAMPAIGN_CLOSED', 'This campaign is already closed.');
      await ADAPTERS[c.channel]!.close(c.externalId);
      const u = await tx.campaign.update({ where: { id: c.id }, data: { status: 'CLOSED', endAt: new Date() } });
      await audit({ entityType: 'Campaign', entityId: c.id, action: 'campaign.closed', before: { status: c.status }, after: { status: 'CLOSED' } });
      return { status: 200, body: await campaignDto(tx, u) };
    });
    return reply;
  });

  // Tracked apply link (the candidate app's /apply/{id} page calls this, then shows the opportunity).
  // Replaces SPEC's POST /public/campaigns/{id}/apply: applying needs sign-in, so the application itself is
  // recorded when the candidate starts their enrollment (FLOW2-SME wins).
  app.post(
    '/public/campaigns/:id/click',
    { config: { access: 'public', rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['campaigns'], params: IdParams, response: { 200: z.object({ opportunityId: z.string().uuid().nullable(), live: z.boolean() }) } } },
    async (req) => {
      const c = await db.campaign.findUnique({ where: { id: req.params.id }, include: { project: { include: { opportunity: true } } } });
      if (!c) throw notFound('Campaign not found');
      if (c.status === 'LIVE') await db.campaign.update({ where: { id: c.id }, data: { clicks: { increment: 1 } } });
      return { opportunityId: c.project.opportunity?.id ?? null, live: c.status === 'LIVE' };
    },
  );

  // Apply Connect webhooks arrive here only if the partnership is approved; until then the channel is disabled.
  app.post('/webhooks/job-board/:channel', { config: { access: 'public' }, schema: { hide: true, params: z.object({ channel: z.string() }) } }, async () => {
    throw new AppError(501, 'CHANNEL_NOT_AVAILABLE', 'No job-board webhooks are enabled.');
  });
};
