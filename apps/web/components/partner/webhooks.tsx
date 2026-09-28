'use client';

import { PARTNER_WEBHOOK_EVENTS } from '@praxis/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import type { PartnerWebhook, PartnerWebhookDelivery } from '@/lib/partner-api';
import { EnvPill, fmtDate, fmtDateTime, StatePill } from './labels';
import { partnerMutate } from './partner-mutate';
import { SecretOnce } from './secret-once';

type Created = PartnerWebhook & { signingSecret: string | null };

const HTTPS = /^https:\/\/\S+$/;
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

/** Webhook endpoints per environment. The signing secret is shown once; deliveries are signed with it. */
export function PartnerWebhooks({ initial }: { initial: PartnerWebhook[] }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [environment, setEnvironment] = useState<'SANDBOX' | 'LIVE'>('SANDBOX');
  const [all, setAll] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const [created, setCreated] = useState<Created | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const u = url.trim();
    if (!HTTPS.test(u) && !LOCAL.test(u)) return setError('Enter an HTTPS URL, for example https://example.com/praxis/webhooks.');
    if (!all && !events.length) return setError('Choose at least one event, or receive all events.');
    setPending(true);
    const res = await partnerMutate<Created>('/webhooks', { url: u, environment, events: all ? ['*'] : events });
    setPending(false);
    if (!res.ok || !res.data) return setError(res.status === 400 ? 'The URL was not accepted. Use a full HTTPS URL.' : res.error);
    setCreated(res.data);
    setUrl('');
    router.refresh();
  }

  async function disable(id: string) {
    setError(null);
    const res = await partnerMutate(`/webhooks/${id}/disable`);
    if (!res.ok) return setError(res.error);
    setConfirmDisable(null);
    router.refresh();
  }

  return (
    <div className="space-y-4 text-sm">
      <form onSubmit={create} noValidate className="card space-y-4 p-4">
        <RequiredNote />
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-64 flex-1">
            Endpoint URL
            <Req />
            <input value={url} required onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/praxis/webhooks" className="mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1.5" />
          </label>
          <label>
            Environment
            <Req />
            <select value={environment} required onChange={(e) => setEnvironment(e.target.value as 'SANDBOX' | 'LIVE')} className="mt-1 block rounded-md border border-line bg-surface px-2 py-1.5">
              <option value="SANDBOX">Sandbox events</option>
              <option value="LIVE">Live events</option>
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="font-medium">Events<Req /></legend>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            All events, including ones added later
          </label>
          {!all && (
            <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {PARTNER_WEBHOOK_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-1.5 font-mono text-xs">
                  <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))} />
                  {ev}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add webhook'}
        </button>
      </form>

      {created?.signingSecret && (
        <SecretOnce
          title={`Webhook added for ${created.environment === 'LIVE' ? 'live' : 'sandbox'} events`}
          label="Signing secret"
          value={created.signingSecret}
          extra={
            <p className="mt-2">
              Each delivery carries a <code className="font-mono">Praxis-Signature: t=&lt;unix time&gt;,v1=&lt;signature&gt;</code> header. Check it with HMAC-SHA256 of{' '}
              <code className="font-mono">&lt;t&gt;.&lt;raw body&gt;</code> and this secret, and reject old timestamps.
            </p>
          }
          onDone={() => setCreated(null)}
        />
      )}

      {initial.length === 0 ? (
        <p className="card p-4 text-fg-muted">No webhooks yet. Add one to hear about requisitions and candidate progress as it happens.</p>
      ) : (
        <ul className="card divide-y divide-hairline">
          {initial.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <EnvPill env={w.environment} />
              <StatePill state={w.status} label={w.status === 'ACTIVE' ? 'Active' : 'Disabled'} />
              <code className="min-w-0 font-mono break-all">{w.url}</code>
              <span className="text-fg-muted">
                {w.events.includes('*') ? 'all events' : `${w.events.length} event${w.events.length === 1 ? '' : 's'}`} · added {fmtDate(w.createdAt)}
              </span>
              {w.status === 'ACTIVE' && (
                <span className="ml-auto flex items-center gap-3">
                  {confirmDisable === w.id ? (
                    <>
                      <span>Disable? No more deliveries go to this URL.</span>
                      <button type="button" className="font-semibold text-error" onClick={() => disable(w.id)}>
                        Disable
                      </button>
                      <button type="button" className="text-link" onClick={() => setConfirmDisable(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="text-link" onClick={() => setConfirmDisable(w.id)}>
                      Disable
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
    </div>
  );
}

const DELIVERY_LABEL: Record<string, string> = { PENDING: 'Retrying', SENDING: 'Sending', DELIVERED: 'Delivered', FAILED: 'Failed' };

/** Recent deliveries (latest 200) with their status; any delivery can be replayed with the same event id. */
export function PartnerDeliveries({ initial, filter }: { initial: PartnerWebhookDelivery[]; filter: string | null }) {
  const router = useRouter();
  const [replayed, setReplayed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function replay(id: string) {
    setError(null);
    const res = await partnerMutate<{ id: string; status: string }>(`/webhook-deliveries/${id}/replay`);
    if (!res.ok) return setError(res.error);
    setReplayed({ ...replayed, [id]: true });
    router.refresh();
  }

  return (
    <div className="space-y-3 text-sm">
      <nav aria-label="Filter deliveries" className="flex flex-wrap gap-2">
        {[
          { v: null, l: 'All' },
          { v: 'FAILED', l: 'Failed' },
          { v: 'PENDING', l: 'Retrying' },
          { v: 'DELIVERED', l: 'Delivered' },
        ].map((f) => (
          <Link key={f.l} href={`/partner/integrations${f.v ? `?deliveries=${f.v}` : ''}#deliveries`} aria-current={filter === f.v ? 'true' : undefined} aria-pressed={filter === f.v} className="chip">
            {f.l}
          </Link>
        ))}
      </nav>
      {initial.length === 0 ? (
        <p className="card p-4 text-fg-muted">No deliveries{filter ? ' with this status' : ' yet'}.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-fg-muted">
              <tr className="border-b border-hairline">
                <th className="px-4 py-2 font-medium">Event</th>
                <th className="px-4 py-2 font-medium">Endpoint</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Attempts</th>
                <th className="px-4 py-2 font-medium">Last response</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {initial.map((d) => (
                <tr key={d.id} className="border-b border-hairline align-top last:border-0">
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs">{d.eventType}</span>
                    <span className="block font-mono text-xs text-fg-muted">{d.eventId}</span>
                    {d.replayOf && <span className="block text-xs text-fg-muted">Replay</span>}
                  </td>
                  <td className="max-w-56 px-4 py-2 font-mono text-xs break-all">{d.url}</td>
                  <td className="px-4 py-2">
                    <StatePill state={d.status} label={DELIVERY_LABEL[d.status] ?? d.status} />
                    {d.deliveredAt && <span className="block text-xs text-fg-muted">{fmtDateTime(d.deliveredAt)}</span>}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{d.attempts}</td>
                  <td className="px-4 py-2 text-xs">
                    {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : '—'}
                    {d.lastError && <span className="block max-w-56 break-words text-error">{d.lastError}</span>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(d.createdAt)}</td>
                  <td className="px-4 py-2">
                    {replayed[d.id] ? (
                      <span className="text-fg-muted">Queued</span>
                    ) : (
                      <button type="button" className="text-link" onClick={() => replay(d.id)}>
                        Replay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
    </div>
  );
}
