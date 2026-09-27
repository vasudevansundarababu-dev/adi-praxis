import type { EventHandler } from '../outbox/handlers';
import { writeAudit } from '../platform/audit';
import { markInProgressIfStarted } from './task-service';

/** When a project becomes STAFFED after tasks were already issued, it moves straight to IN_PROGRESS. */
export function startProjectOnStaffed(): EventHandler {
  return {
    name: 'flow3.start-project-on-staffed',
    event: 'project.staffed',
    async handle(event, tx) {
      const { projectId } = event.payload as { projectId: string };
      await markInProgressIfStarted(tx, projectId, (i) => writeAudit(tx, { clientId: event.clientId, actorType: 'SYSTEM', actorId: 'task-generator' }, i));
    },
  };
}
