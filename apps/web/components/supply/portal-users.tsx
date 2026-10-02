'use client';

import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { TemporaryPassword } from '@/components/users/temporary-password';
import { ActionMessages, input, useAction } from './action';
import type { PartnerDetail } from './types';
import { fmtDateTime, StatePill } from './ui';

const TH = 'px-3 py-2 font-medium';
const TD = 'px-3 py-2 align-top';

/** Partners → a partner → Portal users: add people with a temporary password, reset passwords, disable or enable. */
export function PortalUsers({ partnerId, users }: { partnerId: string; users: PartnerDetail['users'] }) {
  const a = useAction();
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const signInAt = typeof window === 'undefined' ? '/partner/login' : `${window.location.origin}/partner/login`;

  return (
    <div className="mt-3 space-y-4">
      {issued && <TemporaryPassword email={issued.email} password={issued.password} signInAt={signInAt} onDone={() => setIssued(null)} />}
      {users.length === 0 ? (
        <p className="text-sm text-fg-muted">No users yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-fg-muted">
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Email</th>
                <th className={TH}>Status</th>
                <th className={TH}>Last sign-in</th>
                <th className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className={TD}>{u.name}</td>
                  <td className={TD}>{u.email}</td>
                  <td className={TD}>
                    <StatePill state={u.status} />
                    {u.mustChangePassword && <span className="pill pill-warning ml-2 whitespace-nowrap text-xs">Temporary password</span>}
                  </td>
                  <td className={TD}>{fmtDateTime(u.lastLoginAt)}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                      {confirmReset === u.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-fg-muted">Sign them out and issue a new password?</span>
                          <button
                            type="button"
                            disabled={a.pending}
                            className="text-link underline"
                            onClick={async () => {
                              const res = await a.run<{ temporaryPassword?: string }>('POST', `/partners/${partnerId}/users/${u.id}/password-reset`, {}, { success: `${u.email} was signed out and must choose a new password.` });
                              setConfirmReset(null);
                              if (res.ok && res.data?.temporaryPassword) setIssued({ email: u.email, password: res.data.temporaryPassword });
                            }}
                          >
                            Yes, reset
                          </button>
                          <button type="button" className="text-link underline" onClick={() => setConfirmReset(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="text-link underline" onClick={() => setConfirmReset(u.id)}>
                          Reset password
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={a.pending}
                        className="text-link underline"
                        onClick={() =>
                          a.run('PATCH', `/partners/${partnerId}/users/${u.id}/status`, { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }, { success: u.status === 'ACTIVE' ? `${u.email} is disabled and signed out.` : `${u.email} can sign in again.` })
                        }
                      >
                        {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await a.run<{ email: string; temporaryPassword?: string }>('POST', `/partners/${partnerId}/users`, { name, email });
          if (res.ok && res.data?.temporaryPassword) {
            setIssued({ email: res.data.email, password: res.data.temporaryPassword });
            setName('');
            setEmail('');
          }
        }}
      >
        <RequiredNote className="sm:col-span-3" />
        <label className="block">
          Name<Req />
          <input id="portal-user-name" required value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="block">
          Email<Req />
          <input id="portal-user-email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        </label>
        <button type="submit" disabled={a.pending || !name || !email} className="btn btn-primary">
          Add user
        </button>
        <p className="text-xs text-fg-muted sm:col-span-3">Praxis creates a temporary password and shows it once; the person chooses their own when they first sign in.</p>
      </form>
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </div>
  );
}
