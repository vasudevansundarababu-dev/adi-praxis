import type { Metadata } from 'next';
import Link from 'next/link';
import { fmtMoney, fmtPeriod } from '@/components/partner/labels';
import { getPartnerMe, partnerGet, type PartnerCandidate, type PartnerRequisition, type PartnerStatement } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'Partner portal' };

type Tile = { label: string; count?: number | string; hint: string; href: string };

/** Partner home: open requisitions, candidates in progress and the latest statement, each linking to its page. */
export default async function PartnerHomePage() {
  const me = (await getPartnerMe())!;
  const [reqs, cands, stmts] = await Promise.all([
    partnerGet<{ items: PartnerRequisition[] }>('/requisitions'),
    partnerGet<{ items: PartnerCandidate[] }>('/candidates'),
    partnerGet<{ items: PartnerStatement[] }>('/statements'),
  ]);
  const requisitions = reqs.data?.items ?? [];
  const candidates = cands.data?.items ?? [];
  const latest = stmts.data?.items[0];
  const active = candidates.filter((c) => ['RECEIVED', 'INVITED'].includes(c.states.submission ?? '')).length;
  const certified = candidates.filter((c) => c.states.certification === 'PASSED' || c.states.certification === 'CERTIFIED').length;

  const tiles: Tile[] = [
    { label: 'Open requisitions', count: requisitions.filter((r) => r.state === 'OPEN').length, hint: 'Read the requirements and put candidates forward.', href: '/partner/requisitions' },
    { label: 'Candidates in progress', count: active, hint: 'Follow each candidate through identity, selection and certification.', href: '/partner/candidates' },
    { label: 'Certified candidates', count: certified, hint: 'Candidates who passed their tier certification.', href: '/partner/candidates' },
    {
      label: latest ? `Statement for ${fmtPeriod(latest.period)}` : 'Statements',
      count: latest ? Object.entries(latest.totals).map(([cur, amt]) => fmtMoney(amt, cur)).join(' + ') || '—' : undefined,
      hint: 'Monthly certified-candidate fees.',
      href: '/partner/statements',
    },
  ];

  return (
    <div className="space-y-8">
      <section className="hero p-6 sm:p-8">
        <p className="muted text-sm">{me.partner.name}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Welcome, {me.user.name.split(' ')[0]}</h1>
        <p className="muted mt-2 max-w-2xl">
          Put forward experts for open requisitions and follow their progress. ADI Praxis invites each candidate, checks their identity and certifies them; every selection is made by a
          person.
        </p>
        <Link href="/partner/requisitions" className="btn mt-5 bg-white text-brand-navy shadow-lg hover:bg-white/90">
          See open requisitions →
        </Link>
      </section>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link href={t.href} className="card card-link flex h-full flex-col p-5">
              <span className="text-sm font-medium text-fg-muted">{t.label}</span>
              {t.count !== undefined && <span className="mt-1 text-3xl font-bold tabular-nums">{t.count}</span>}
              <span className="mt-2 text-sm text-fg-muted">{t.hint}</span>
              <span className="mt-auto pt-3 text-sm font-semibold text-link">Open →</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-fg-muted">
        Candidates you submit in this portal are live: ADI Praxis emails them an invite. To test an integration without real candidates, create a sandbox API client under{' '}
        <Link href="/partner/integrations" className="text-link">
          API &amp; webhooks
        </Link>
        .
      </p>
    </div>
  );
}
