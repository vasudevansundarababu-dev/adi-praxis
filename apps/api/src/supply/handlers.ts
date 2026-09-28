import type { EventHandler } from '../outbox/handlers';
import { onFlow2Change } from './submissions';

/** FLOW 2 → partners (registered only when SME_SUPPLY_ENABLED): identity verified, and the human selection decision. */
export function supplyHandlers(): EventHandler[] {
  return [
    {
      name: 'm10.partner-identity-verified',
      event: 'sme.identity_verified',
      async handle(event, tx) {
        const { smeUserId } = event.payload as { smeUserId: string };
        await onFlow2Change(tx, smeUserId, { dimension: 'identity', to: 'VERIFIED', event: 'candidate.identity_verified' });
      },
    },
    {
      name: 'm10.partner-selection-decided',
      event: 'enrollment.decided',
      async handle(event, tx) {
        const { enrollmentId, outcome } = event.payload as { enrollmentId: string; outcome: string };
        if (outcome !== 'SELECTED' && outcome !== 'NOT_SELECTED') return;
        const e = await tx.enrollment.findUnique({ where: { id: enrollmentId } });
        if (!e) return;
        await onFlow2Change(tx, e.smeUserId, { dimension: 'selection', to: outcome, event: outcome === 'SELECTED' ? 'candidate.selected' : 'candidate.not_selected', enrollmentId });
      },
    },
  ];
}
