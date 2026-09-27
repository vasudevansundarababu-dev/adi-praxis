import { AssignRequest, MatchesResponse, RejectRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import type { Geocoder } from '../staffing/geocoder';
import { RuleBasedMatchService } from '../staffing/match-service';
import type { SelectionGate } from '../staffing/selection-gate';
import { activeAssignmentCount, ensureJobDescription, listMatches, matchRequestFor, runAndStoreMatches } from '../staffing/staffing-service';
import { loadProject } from './projects';

const IdParams = z.object({ id: z.string().uuid() });
const ACCESS = ['PM', 'ADMIN'] as const;
const MatchesWithWarnings = MatchesResponse.extend({ warnings: z.array(z.string()) });

const notStaffing = (status: string) =>
  new AppError(409, 'NOT_STAFFING', `Staffing actions need a project in STAFFING (this one is ${status}).`);

/** Locks the project row so concurrent assignment requests are serialised. */
const lockProject = (tx: Tx, id: string) => tx.$executeRaw`SELECT 1 FROM "Project" WHERE id = ${id}::uuid FOR UPDATE`;

/** FLOW 2 core: Resource Assignment (SPEC). */
export const staffingRoutes: FastifyPluginAsyncZod<{ db: Db; geocoder: Geocoder; selectionGate: SelectionGate }> = async (app, { db, geocoder, selectionGate }) => {
  // Opening the screen: READY_FOR_STAFFING -> STAFFING, make sure there is a JD, and (re-)run the match.
  app.post(
    '/projects/:id/match',
    { config: { access: ACCESS }, schema: { tags: ['staffing'], params: IdParams, response: { 200: MatchesWithWarnings } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        if (p.status !== 'READY_FOR_STAFFING' && p.status !== 'STAFFING') throw notStaffing(p.status);
        await lockProject(tx, p.id);

        if (p.status === 'READY_FOR_STAFFING') {
          await tx.project.update({ where: { id: p.id }, data: { status: 'STAFFING' } });
          await audit({ entityType: 'Project', entityId: p.id, action: 'project.staffing_started', before: { status: 'READY_FOR_STAFFING' }, after: { status: 'STAFFING' } });
        }
        const jd = await ensureJobDescription(tx, p.id);
        if (jd.changed !== 'kept') {
          await audit({ entityType: 'Project', entityId: p.id, action: 'project.jd_linked', before: { jobDescriptionId: null }, after: { jobDescriptionId: jd.jobDescriptionId, how: jd.changed } });
        }
        const run = await runAndStoreMatches(tx, new RuleBasedMatchService(tx, geocoder), p.id);
        await audit({ entityType: 'Project', entityId: p.id, action: 'project.matched', after: { matched: run.total, stored: run.stored } });
        return { status: 200, body: await listMatches(tx, p.id, run.warnings) };
      });
      return reply;
    },
  );

  app.get(
    '/projects/:id/matches',
    { config: { access: ACCESS }, schema: { tags: ['staffing'], params: IdParams, response: { 200: MatchesWithWarnings } } },
    async (req) => {
      const p = await loadProject(db, req.params.id, req.actor!);
      return listMatches(db, p.id);
    },
  );

  // Assign specific candidates, or the top N available by rank.
  app.post(
    '/projects/:id/assignments',
    { config: { access: ACCESS }, schema: { tags: ['staffing'], params: IdParams, body: AssignRequest, response: { 200: MatchesWithWarnings } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        await lockProject(tx, p.id);
        const current = await tx.project.findUniqueOrThrow({ where: { id: p.id } });
        if (current.status !== 'STAFFING') throw notStaffing(current.status);

        const required = current.requiredWorkers ?? 0;
        const assignedBefore = await activeAssignmentCount(tx, p.id);
        const shortfall = Math.max(0, required - assignedBefore);

        let ids: string[];
        if ('topN' in req.body) {
          const assigned = new Set((await tx.projectAssignment.findMany({ where: { projectId: p.id, releasedAt: null } })).map((a) => a.candidateId));
          const ranked = await tx.projectMatch.findMany({ where: { projectId: p.id }, orderBy: { rank: 'asc' }, select: { candidateId: true } });
          ids = ranked.map((r) => r.candidateId).filter((id) => !assigned.has(id)).slice(0, req.body.topN);
          if (ids.length === 0) throw new AppError(409, 'NO_CANDIDATES', 'No available matched candidates to assign. Re-run the match or launch sourcing.');
        } else {
          ids = [...new Set(req.body.candidateIds)];
        }
        if (ids.length > shortfall) {
          throw new AppError(409, 'OVER_ASSIGNMENT', `Only ${shortfall} more worker(s) needed; you selected ${ids.length}.`);
        }

        // Lock the candidates, then re-check eligibility and capacity inside this transaction so concurrent
        // assignments on other projects cannot overbook anyone.
        await tx.$executeRaw`SELECT 1 FROM "Candidate" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
        const run = await new RuleBasedMatchService(tx, geocoder).findMatches(await matchRequestFor(tx, p.id, ids));
        const eligible = new Map(run.matches.map((m) => [m.candidateId, m]));
        const already = new Set((await tx.projectAssignment.findMany({ where: { projectId: p.id, releasedAt: null, candidateId: { in: ids } } })).map((a) => a.candidateId));

        const problems: string[] = [];
        for (const id of ids) {
          if (already.has(id)) problems.push(`${id}: already assigned`);
          else if (!eligible.has(id)) problems.push(`${id}: no longer eligible (filters, identity, capacity or rejected)`);
          else if (!(await selectionGate.isSelected({ candidateId: id, projectId: p.id }))) problems.push(`${id}: not selected for this project's pool`);
        }
        if (problems.length) throw new AppError(409, 'NOT_ASSIGNABLE', `Cannot assign: ${problems.join('; ')}.`, { problems });

        for (const id of ids) {
          const score = eligible.get(id)!.score;
          const a = await tx.projectAssignment.upsert({
            where: { projectId_candidateId: { projectId: p.id, candidateId: id } },
            create: { clientId: p.clientId, projectId: p.id, candidateId: id, matchScore: score },
            update: { releasedAt: null, assignedAt: new Date(), matchScore: score },
          });
          await audit({ entityType: 'ProjectAssignment', entityId: a.id, action: 'project.candidate_assigned', after: { projectId: p.id, candidateId: id, matchScore: score } });
          await emit({ name: 'candidate.assigned', aggregateType: 'ProjectAssignment', aggregateId: a.id, payload: { projectId: p.id, candidateId: id, projectAssignmentId: a.id } });
        }

        const assigned = assignedBefore + ids.length;
        if (assigned >= required) {
          await tx.project.update({ where: { id: p.id }, data: { status: 'STAFFED' } });
          await audit({ entityType: 'Project', entityId: p.id, action: 'project.staffed', before: { status: 'STAFFING' }, after: { status: 'STAFFED', assigned, requiredWorkers: required } });
          await emit({ name: 'project.staffed', aggregateType: 'Project', aggregateId: p.id, payload: { projectId: p.id, assigned, requiredWorkers: required } });
        }
        return { status: 200, body: await listMatches(tx, p.id) };
      });
      return reply;
    },
  );

  app.delete(
    '/projects/:id/assignments/:aid',
    {
      config: { access: ACCESS },
      schema: { tags: ['staffing'], params: IdParams.extend({ aid: z.string().uuid() }), response: { 200: MatchesWithWarnings } },
    },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        await lockProject(tx, p.id);
        const current = await tx.project.findUniqueOrThrow({ where: { id: p.id } });
        // After STAFFED, releasing a worker is FLOW 3's reclaim (M5), not a staffing action.
        if (current.status !== 'STAFFING') throw notStaffing(current.status);
        const a = await tx.projectAssignment.findFirst({ where: { id: req.params.aid, projectId: p.id, releasedAt: null } });
        if (!a) throw notFound('Assignment not found');
        await tx.projectAssignment.update({ where: { id: a.id }, data: { releasedAt: new Date() } });
        await audit({ entityType: 'ProjectAssignment', entityId: a.id, action: 'project.candidate_released', before: { releasedAt: null }, after: { candidateId: a.candidateId } });
        return { status: 200, body: await listMatches(tx, p.id) };
      });
      return reply;
    },
  );

  // Reject a candidate for this project only (not a global exclusion).
  app.post(
    '/projects/:id/rejections',
    { config: { access: ACCESS }, schema: { tags: ['staffing'], params: IdParams, body: RejectRequest, response: { 200: MatchesWithWarnings } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await loadProject(tx, req.params.id, actor);
        if (p.status !== 'STAFFING') throw notStaffing(p.status);
        const candidate = await tx.candidate.findFirst({ where: { id: req.body.candidateId, clientId: p.clientId } });
        if (!candidate) throw notFound('Candidate not found');
        const assigned = await tx.projectAssignment.findFirst({ where: { projectId: p.id, candidateId: candidate.id, releasedAt: null } });
        if (assigned) throw new AppError(409, 'ASSIGNED', 'Release the assignment before rejecting this candidate.');
        const r = await tx.projectMatchRejection.upsert({
          where: { projectId_candidateId: { projectId: p.id, candidateId: candidate.id } },
          create: { clientId: p.clientId, projectId: p.id, candidateId: candidate.id, reason: req.body.reason, rejectedById: actor.userId },
          update: { reason: req.body.reason, rejectedById: actor.userId },
        });
        await tx.projectMatch.deleteMany({ where: { projectId: p.id, candidateId: candidate.id } });
        await audit({ entityType: 'ProjectMatchRejection', entityId: r.id, action: 'project.candidate_rejected', after: { projectId: p.id, candidateId: candidate.id, reason: req.body.reason ?? null } });
        return { status: 200, body: await listMatches(tx, p.id) };
      });
      return reply;
    },
  );
};
