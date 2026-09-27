import type { EventHandler } from '../outbox/handlers';
import type { Geocoder } from './geocoder';
import { RuleBasedMatchService } from './match-service';
import { runAndStoreMatches } from './staffing-service';

/**
 * SPEC FLOW 2: approved applicants appear in the match list without a manual refresh. When a candidate is
 * approved for a project that is still staffing, re-run its match; the Resource Assignment screen polls.
 * `candidate.approved` is emitted by the selection flow (M4).
 */
export function rematchOnApproval(geocoder: Geocoder): EventHandler {
  return {
    name: 'flow2.rematch-on-approval',
    event: 'candidate.approved',
    async handle(event, tx) {
      const projectId = (event.payload as { projectId?: string }).projectId;
      if (!projectId) return;
      const p = await tx.project.findUnique({ where: { id: projectId } });
      if (!p || p.status !== 'STAFFING') return;
      const run = await runAndStoreMatches(tx, new RuleBasedMatchService(tx, geocoder), projectId);
      await tx.auditEvent.create({
        data: {
          clientId: p.clientId,
          actorType: 'SYSTEM',
          actorId: 'flow2.rematch-on-approval',
          entityType: 'Project',
          entityId: projectId,
          action: 'project.matched',
          after: { matched: run.total, stored: run.stored, trigger: 'candidate.approved', eventId: event.id },
        },
      });
    },
  };
}

/** SPEC FLOW 2: close the campaign automatically when the project is STAFFED. */
export function closeCampaignsOnStaffed(): EventHandler {
  return {
    name: 'flow2.close-campaigns-on-staffed',
    event: 'project.staffed',
    async handle(event, tx) {
      const projectId = (event.payload as { projectId?: string }).projectId;
      if (!projectId) return;
      const open = await tx.campaign.findMany({ where: { projectId, status: { in: ['LIVE', 'PAUSED'] } } });
      for (const c of open) {
        await tx.campaign.update({ where: { id: c.id }, data: { status: 'CLOSED', endAt: new Date() } });
        await tx.auditEvent.create({
          data: {
            clientId: c.clientId,
            actorType: 'SYSTEM',
            actorId: 'flow2.close-campaigns-on-staffed',
            entityType: 'Campaign',
            entityId: c.id,
            action: 'campaign.closed',
            before: { status: c.status },
            after: { status: 'CLOSED', trigger: 'project.staffed', eventId: event.id },
          },
        });
      }
    },
  };
}
