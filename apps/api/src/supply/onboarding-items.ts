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
  if (!s?.requisition.guidelinesPackageId) return [];
  const r = s.requisition;
  const cert = await tx.certification.findFirst({ where: { smeUserId, domain: r.domain, tier: r.tier }, orderBy: { createdAt: 'desc' } });
  return [
    {
      key: 'certification',
      kind: 'certification' as const,
      title: 'Guidelines course and certification',
      description: 'Complete the course for your tier and pass its certification test. It opens here once you are selected.',
      done: cert?.state === 'PASSED',
      data: cert ? { certificationId: cert.id, state: cert.state } : null,
      terms: null,
    },
  ];
}
