'use client';

import { PARTNER_SCOPES } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PartnerApiClient } from '@/lib/partner-api';
import { EnvPill, fmtDate } from './labels';
import { partnerMutate } from './partner-mutate';
import { SecretOnce } from './secret-once';

type Created = PartnerApiClient & { clientSecret: string | null };

/** OAuth client credentials for the Partner API, one or more per environment. Secrets are shown once. */
export function PartnerApiClients({ initial }: { initial: PartnerApiClient[] }) {
  const router = useRouter();
  const [environment, setEnvironment] = useState<'SANDBOX' | 'LIVE'>('SANDBOX');
  const [scopes, setScopes] = useState<string[]>([...PARTNER_SCOPES]);
  const [shown, setShown] = useState<{ created: Created; rotated: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: 'rotate' | 'revoke' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!scopes.length) return setError('Choose at least one scope.');
    setPending(true);
    const res = await partnerMutate<Created>('/clients', { environment, scopes });
    setPending(false);
    if (!res.ok || !res.data) return setError(res.error);
    setShown({ created: res.data, rotated: false });
    router.refresh();
  }

  async function act(id: string, action: 'rotate' | 'revoke') {
    setError(null);
    const res = await partnerMutate<Created>(`/clients/${id}/${action}`);
    if (!res.ok || !res.data) return setError(res.error);
    setConfirm(null);
    if (action === 'rotate') setShown({ created: res.data, rotated: true });
    router.refresh();
  }

  return (
    <div className="space-y-4 text-sm">
      <form onSubmit={create} className="card flex flex-wrap items-end gap-4 p-4">
        <label>
          Environment
          <select value={environment} onChange={(e) => setEnvironment(e.target.value as 'SANDBOX' | 'LIVE')} className="mt-1 block rounded-md border border-line bg-surface px-2 py-1.5">
            <option value="SANDBOX">Sandbox — test data, no real candidates</option>
            <option value="LIVE">Live — real candidates are invited</option>
          </select>
        </label>
        <fieldset>
          <legend>Scopes</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {PARTNER_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 font-mono text-xs">
                <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create API client'}
        </button>
      </form>

      {shown && shown.created.clientSecret && (
        <SecretOnce
          title={`${shown.rotated ? 'New secret for' : 'Created'} ${shown.created.environment === 'LIVE' ? 'live' : 'sandbox'} client ${shown.created.clientId}`}
          label="Client secret"
          value={shown.created.clientSecret}
          extra={
            <p className="mt-2">
              Client ID: <code className="font-mono">{shown.created.clientId}</code>
              {shown.rotated ? '. The old secret and its access tokens stopped working.' : ''}
            </p>
          }
          onDone={() => setShown(null)}
        />
      )}

      {initial.length === 0 ? (
        <p className="card p-4 text-fg-muted">No API clients yet. Start with a sandbox client to build and test your integration.</p>
      ) : (
        <ul className="card divide-y divide-hairline">
          {initial.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <EnvPill env={c.environment} />
              <code className="font-mono">{c.clientId}</code>
              <span className="text-fg-muted">
                {c.scopes.join(', ')} · created {fmtDate(c.createdAt)}
                {c.rotatedAt ? ` · rotated ${fmtDate(c.rotatedAt)}` : ''}
                {c.revokedAt ? ` · revoked ${fmtDate(c.revokedAt)}` : ''}
              </span>
              {!c.revokedAt && (
                <span className="ml-auto flex flex-wrap items-center gap-3">
                  {confirm?.id === c.id ? (
                    <>
                      <span>{confirm.action === 'rotate' ? 'Rotate? The current secret stops working at once.' : 'Revoke? Calls with this client stop at once.'}</span>
                      <button type="button" className="font-semibold text-error" onClick={() => act(c.id, confirm.action)}>
                        {confirm.action === 'rotate' ? 'Rotate' : 'Revoke'}
                      </button>
                      <button type="button" className="text-link" onClick={() => setConfirm(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="text-link" onClick={() => setConfirm({ id: c.id, action: 'rotate' })}>
                        Rotate secret
                      </button>
                      <button type="button" className="text-link" onClick={() => setConfirm({ id: c.id, action: 'revoke' })}>
                        Revoke
                      </button>
                    </>
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
