import { TIER_LABELS } from '@praxis/shared';
import type { Metadata } from 'next';
import { NoAccess } from '@/components/no-access';
import { FeeTermsForm, PartnerSettings } from '@/components/supply/partner-forms';
import { PortalUsers } from '@/components/supply/portal-users';
import type { PartnerDetail } from '@/components/supply/types';
import { BackLink, Facts, fmtDate, fmtDateTime, NotFoundCard, StatePill, TD, TH } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Partner' };

export default async function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.includes('ADMIN')) return <NoAccess need="Admins" />;
  const { id } = await params;
  const { data: p } = await apiGet<PartnerDetail>(`/partners/${id}`);
  if (!p) return <NotFoundCard what="partner" back="/partners" backLabel="Back to partners" />;
  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/partners">Partners</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <StatePill state={p.status} />
          <StatePill state={p.businessVerification} label={`Business check: ${p.businessVerification.toLowerCase()}`} />
        </div>
      </div>
      <Facts
        rows={[
          ['Domains', p.allowedDomains.join(', ') || 'Any domain'],
          ['Tiers', p.allowedTiers.map((t) => TIER_LABELS[t]).join(', ') || 'Any tier'],
          ['Contacts', p.contacts.length ? p.contacts.map((c) => `${c.name} <${c.email}>${c.role ? ` · ${c.role}` : ''}`).join('; ') : '—'],
          ['Fee terms version', p.feeTermsVersion ?? 'Not agreed. Certified-candidate fees are recorded at zero until terms are set.'],
          ['Onboarded', fmtDate(p.createdAt)],
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <PartnerSettings partner={p} />
        <FeeTermsForm partnerId={p.id} currentVersion={p.feeTermsVersion} />
      </div>

      <section className="card p-4">
        <h2 className="font-semibold">Portal users</h2>
        <p className="mt-1 text-sm text-fg-muted">People at the partner who sign in to the partner portal. They see only their own partner’s requisitions, candidates and statements.</p>
        <PortalUsers partnerId={p.id} users={p.users} />
      </section>

      <section className="card p-4">
        <h2 className="font-semibold">API clients and webhooks</h2>
        <p className="mt-1 text-sm text-fg-muted">The partner manages its own keys and webhooks in the partner portal. Secrets are never shown here.</p>
        <ul className="mt-3 divide-y divide-line text-sm">
          {p.clients.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
              <code>{c.clientId}</code>
              <StatePill state={c.environment === 'LIVE' ? 'ACTIVE' : 'DRAFT'} label={c.environment === 'LIVE' ? 'Live' : 'Sandbox'} />
              <span className="text-fg-muted">{c.scopes.join(', ')}</span>
              <span className="ml-auto text-xs text-fg-muted">
                created {fmtDate(c.createdAt)}
                {c.rotatedAt ? ` · rotated ${fmtDate(c.rotatedAt)}` : ''}
                {c.revokedAt ? ` · revoked ${fmtDate(c.revokedAt)}` : ''}
              </span>
            </li>
          ))}
          {p.webhooks.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-medium">Webhook</span>
              <code className="break-all">{w.url}</code>
              <StatePill state={w.status} />
              <span className="text-xs text-fg-muted">{w.environment === 'LIVE' ? 'Live' : 'Sandbox'} · {w.events.join(', ')}</span>
            </li>
          ))}
          {p.clients.length === 0 && p.webhooks.length === 0 && <li className="py-2 text-fg-muted">No API clients or webhooks yet.</li>}
        </ul>
      </section>
    </div>
  );
}
