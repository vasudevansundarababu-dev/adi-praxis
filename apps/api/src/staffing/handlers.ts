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
