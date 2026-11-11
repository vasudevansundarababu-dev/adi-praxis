import '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { POLICY_PROPOSAL_STATUSES, PolicyProposalDecision, PolicyProposalMeta } from '@praxis/shared';
import type { MalwareScanner, ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError, badRequest, notFound } from '../lib/errors';
import { runCandidateCommand, runCommand } from '../platform/command';
import { MAX_POLICY_BYTES } from '../policy/document-reader';
import { decideProposal, loadProposal, proposalAccess, proposePolicy, reviewerProposalView, smeProposalView } from '../policy/proposals';
import type { SelectionGate } from '../staffing/selection-gate';
import { outstanding, ownTask, workContext } from './work';

const IdParams = z.object({ id: z.string().uuid() });
const ProjectParams = z.object({ projectId: z.string().uuid() });
const ProposalParams = ProjectParams.extend({ proposalId: z.string().uuid() });
const REVIEWERS = ['PM', 'ADMIN', 'REVIEWER'] as const;
const META_FIELDS = ['title', 'category', 'issuer', 'versionLabel', 'language', 'jurisdiction', 'effectiveFrom', 'effectiveTo', 'reason', 'rightsDeclared'];

/**
 * SME policy proposals (authoring v2.1 Wave 3, handover chapter 07). SMEs propose from their own task; assigned
 * Experts (Validators), the owning PM and Admins decide. This is a separate bridge from task-source upload and from
 * the PM/Admin policy routes: nothing proposed is authoritative until accepted, extracted, reviewed and published.
 */
export const policyProposalRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; storage: ObjectStorage; scanner: MalwareScanner; selectionGate: SelectionGate }> = async (app, { db, config, storage, scanner, selectionGate }) => {
  const deps = { storage, scanner, maxPages: config.policy.maxPages };

  app.post('/me/tasks/:id/policy-proposals', { config: { access: 'candidate', rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => req.cookies?.praxis_candidate ?? req.ip } }, schema: { tags: ['work'], params: IdParams } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_POLICY_BYTES + 1, files: 1, fields: META_FIELDS.length } });
    if (!file) throw badRequest('Attach a file');
    const buf = await file.toBuffer();
    if (file.file.truncated || buf.length > MAX_POLICY_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
    if (buf.length === 0) throw new AppError(422, 'EMPTY_FILE', 'The file is empty.');
    const fields = Object.fromEntries(Object.entries(file.fields).map(([k, v]) => [k, (v as { value?: string } | undefined)?.value || undefined]));
    const meta = PolicyProposalMeta.safeParse(fields);
    if (!meta.success) throw new AppError(400, 'VALIDATION_FAILED', meta.error.issues[0]?.message ?? 'Check the document details.', { issues: meta.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await ownTask(tx, req.params.id, actor.smeUserId);
      const ctx = await workContext(tx, selectionGate, actor.smeUserId, t.projectId);
      if (!ctx.ok) outstanding(ctx);
      const r = await proposePolicy(tx, deps, { task: t, smeUserId: actor.smeUserId, meta: meta.data, fileName: file.filename, buf }, audit);
      return { status: r.created ? 201 : 200, body: { ...smeProposalView(r.proposal), created: r.created } };
    });
    return reply;
  });

  /** The SME's own proposals on this task's project. */
  app.get('/me/tasks/:id/policy-proposals', { config: { access: 'candidate' }, schema: { tags: ['work'], params: IdParams } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const items = await db.policyProposal.findMany({ where: { projectId: t.projectId, smeUserId: req.candidate!.smeUserId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { items: items.map(smeProposalView) };
  });

  app.get('/projects/:projectId/policy/proposals', { config: { access: REVIEWERS }, schema: { tags: ['policy'], params: ProjectParams, querystring: z.object({ status: z.enum(POLICY_PROPOSAL_STATUSES).optional() }) } }, async (req) => {
    const a = await proposalAccess(db, req.actor!, req.params.projectId);
    const items = await db.policyProposal.findMany({ where: { projectId: a.project.id, ...(req.query.status ? { status: req.query.status } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
    const smes = await db.smeUser.findMany({ where: { id: { in: [...new Set(items.map((i) => i.smeUserId))] } }, select: { id: true, displayName: true } });
    const name = new Map(smes.map((s) => [s.id, s.displayName]));
    return { role: a.role, items: items.map((p) => reviewerProposalView(p, name.get(p.smeUserId) ?? null)) };
  });

  /** The reviewer's queue across projects: assigned projects for Validators, owned projects for PMs, all for Admins. */
  app.get('/review/policy-proposals', { config: { access: REVIEWERS }, schema: { tags: ['policy'], querystring: z.object({ status: z.enum(POLICY_PROPOSAL_STATUSES).default('PENDING') }) } }, async (req) => {
    const actor = req.actor!;
    const admin = actor.roles.includes('ADMIN');
    const owned = actor.roles.includes('PM') ? await db.project.findMany({ where: { clientId: actor.clientId, ownerId: actor.userId }, select: { id: true } }) : [];
    const assigned = actor.roles.includes('REVIEWER') ? await db.projectReviewer.findMany({ where: { clientId: actor.clientId, userId: actor.userId }, select: { projectId: true } }) : [];
    const projectIds = [...new Set([...owned.map((p) => p.id), ...assigned.map((a) => a.projectId)])];
    const items = await db.policyProposal.findMany({ where: { clientId: actor.clientId, status: req.query.status, ...(admin ? {} : { projectId: { in: projectIds } }) }, orderBy: { createdAt: 'asc' }, take: 200 });
    const [smes, projects] = await Promise.all([
      db.smeUser.findMany({ where: { id: { in: [...new Set(items.map((i) => i.smeUserId))] } }, select: { id: true, displayName: true } }),
      db.project.findMany({ where: { id: { in: [...new Set(items.map((i) => i.projectId))] } }, select: { id: true, name: true } }),
    ]);
    const sme = new Map(smes.map((s) => [s.id, s.displayName]));
    const project = new Map(projects.map((p) => [p.id, p.name]));
    return { items: items.map((p) => ({ ...reviewerProposalView(p, sme.get(p.smeUserId) ?? null), projectId: p.projectId, projectName: project.get(p.projectId) ?? '' })) };
  });

  /** Praxis's reading of the file (redacted if real data was suspected), with page breaks, for comparison with the original. */
  app.get('/projects/:projectId/policy/proposals/:proposalId/text', { config: { access: REVIEWERS }, schema: { tags: ['policy'], params: ProposalParams } }, async (req) => {
    await proposalAccess(db, req.actor!, req.params.projectId);
    const p = await loadProposal(db, req.params.projectId, req.params.proposalId);
    if (!p.textStorageKey) throw notFound('Praxis could not read text from this file; open the original.');
    return JSON.parse((await storage.get(p.textStorageKey)).toString('utf8')) as { text: string; pages: string[] };
  });

  app.get('/projects/:projectId/policy/proposals/:proposalId/file', { config: { access: REVIEWERS }, schema: { tags: ['policy'], params: ProposalParams } }, async (req, reply) => {
    const a = await proposalAccess(db, req.actor!, req.params.projectId);
    const p = await loadProposal(db, req.params.projectId, req.params.proposalId);
    req.log.info({ event: 'policy.proposal_file_opened', proposalId: p.id, role: a.role }, 'policy proposal original opened');
    return reply.header('content-type', p.mediaType).header('content-disposition', `attachment; filename="${p.fileName.replace(/"/g, '')}"`).header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff').send(await storage.get(p.storageKey));
  });

  app.post('/projects/:projectId/policy/proposals/:proposalId/decision', { config: { access: REVIEWERS }, schema: { tags: ['policy'], params: ProposalParams, body: PolicyProposalDecision } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const updated = await decideProposal(tx, deps, actor as Parameters<typeof decideProposal>[2], { projectId: req.params.projectId, proposalId: req.params.proposalId, body: req.body }, audit);
      return { status: 200, body: reviewerProposalView(updated, null) };
    });
    return reply;
  });
};
