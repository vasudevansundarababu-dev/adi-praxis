import type { Db, Tx } from '../db';

/**
 * M10 items on the FLOW 2 C07 checklist (docs/SME-SUPPLY.md section 2), only for applications that came through a
 * requisition (a live partner or direct submission linked to the enrollment):
 * - "Guidelines course and certification": done when the tier's certification is PASSED;
 * - "Payment set-up" (M10c): done when the payee is READY, for direct pay.
 * The platform completes these; the candidate cannot tick them.
 */
export async function supplyOnboardingItems(tx: Db | Tx, enrollmentId: string, smeUserId: string) {
  const s = await tx.partnerSubmission.findFirst({ where: { enrollmentId, sandbox: false }, include: { requisition: true } });
  if (!s) return [];
  const r = s.requisition;
  const items = [];
  if (r.guidelinesPackageId) {
    const cert = await tx.certification.findFirst({ where: { smeUserId, domain: r.domain, tier: r.tier }, orderBy: { createdAt: 'desc' } });
    items.push({
      key: 'certification',
      kind: 'certification' as const,
      title: 'Guidelines course and certification',
      description: 'Complete the course for your tier and pass its certification test. It opens here once you are selected.',
      done: cert?.state === 'PASSED',
      data: cert ? { certificationId: cert.id, state: cert.state } : null,
      terms: null,
    });
  }
  if (r.payRoute === 'DIRECT') {
    const payee = await tx.payee.findUnique({ where: { smeUserId } });
    items.push({
      key: 'payee',
      kind: 'payee' as const,
      title: 'Payment set-up',
      description: 'Set up how you are paid with our payout provider (tax form and payout method). Praxis never sees your bank or tax details.',
      done: payee?.status === 'READY',
      data: { status: payee?.status ?? 'NOT_STARTED' },
      terms: null,
    });
  }
  return items;
}
