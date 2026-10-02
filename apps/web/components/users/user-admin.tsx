'use client';

import { INTERNAL_ROLES, roleLabel, type InternalRole, type InternalUserDto } from '@praxis/shared';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { ActionMessages, input, useAction } from '@/components/supply/action';
import { TemporaryPassword } from './temporary-password';

type Issued = { email: string; password: string };
const TD = 'px-4 py-2 align-top';

function RoleBoxes({ value, onChange, idPrefix }: { value: InternalRole[]; onChange: (r: InternalRole[]) => void; idPrefix: string }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {INTERNAL_ROLES.map((r) => (
        <label key={r} htmlFor={`${idPrefix}-${r}`} className="inline-flex items-center gap-1.5">
          <input id={`${idPrefix}-${r}`} type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          {roleLabel(r)}
        </label>
      ))}
    </div>
  );
}

/** Admin → Users: add console users with a temporary password, change roles, disable, and reset passwords. */
export function UserAdmin({ users, meId, signInAt }: { users: InternalUserDto[]; meId: string; signInAt: string }) {
  const a = useAction();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<InternalRole[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editRoles, setEditRoles] = useState<InternalRole[]>([]);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await a.run<{ email: string; temporaryPassword?: string }>('POST', '/users', { email, name, roles });
    if (res.ok && res.data?.temporaryPassword) {
      setIssued({ email: res.data.email, password: res.data.temporaryPassword });
      setName('');
      setEmail('');
      setRoles([]);
    }
  }

  async function reset(u: InternalUserDto) {
    const res = await a.run<{ temporaryPassword?: string }>('POST', `/users/${u.id}/password-reset`, {}, { success: `${u.email} was signed out everywhere and must choose a new password.` });
    setConfirmReset(null);
    if (res.ok && res.data?.temporaryPassword) setIssued({ email: u.email, password: res.data.temporaryPassword });
  }

  return (
    <div className="space-y-6">
      {issued && <TemporaryPassword email={issued.email} password={issued.password} signInAt={signInAt} onDone={() => setIssued(null)} />}
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />

      <div className="overflow-x-auto card">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Roles</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Last sign-in</th>
              <th className="px-4 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const me = u.id === meId;
              return (
                <tr key={u.id} className="border-t border-line">
                  <td className={TD}>
                    {u.name}
                    {me && <span className="ml-1 text-xs text-fg-muted">(you)</span>}
                  </td>
                  <td className={TD}>{u.email}</td>
                  <td className={TD}>
                    {editing === u.id ? (
                      <div className="space-y-2">
                        <RoleBoxes value={editRoles} onChange={setEditRoles} idPrefix={`roles-${u.id}`} />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={a.pending || editRoles.length === 0}
                            className="btn btn-primary !px-3 !py-1"
                            onClick={async () => {
                              const res = await a.run('PATCH', `/users/${u.id}/roles`, { roles: editRoles }, { success: `Roles saved for ${u.email}.` });
                              if (res.ok) setEditing(null);
                            }}
                          >
                            Save roles
                          </button>
                          <button type="button" className="btn btn-secondary !px-3 !py-1" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      u.roles.map(roleLabel).join(', ')
                    )}
                  </td>
                  <td className={TD}>
                    {u.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                    {u.mustChangePassword && <span className="pill pill-warning ml-2 whitespace-nowrap text-xs">Temporary password</span>}
                  </td>
                  <td className={TD}>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                      {editing !== u.id && (
                        <button
                          type="button"
                          className="text-link underline"
                          onClick={() => {
                            setEditing(u.id);
                            setEditRoles(u.roles);
                          }}
                        >
                          Edit roles
                        </button>
                      )}
                      {!me &&
                        (confirmReset === u.id ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-fg-muted">Sign them out and issue a new password?</span>
                            <button type="button" disabled={a.pending} className="text-link underline" onClick={() => reset(u)}>
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
                        ))}
                      {!me && (
                        <button
                          type="button"
                          disabled={a.pending}
                          className="text-link underline"
                          onClick={() =>
                            a.run('PATCH', `/users/${u.id}/status`, { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }, { success: u.status === 'ACTIVE' ? `${u.email} is disabled and signed out everywhere.` : `${u.email} can sign in again.` })
                          }
                        >
                          {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section aria-labelledby="add-user-h" className="card p-4">
        <h2 id="add-user-h" className="font-semibold">
          Add a user
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Praxis creates a temporary password and shows it to you once. The person chooses their own password when they first sign in.</p>
        <form onSubmit={create} className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <RequiredNote className="sm:col-span-2" />
          <label className="block">
            Name<Req />
            <input id="new-user-name" required value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </label>
          <label className="block">
            Email<Req />
            <input id="new-user-email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          </label>
          <fieldset className="sm:col-span-2">
            <legend>
              Roles<Req />
            </legend>
            <div className="mt-1">
              <RoleBoxes value={roles} onChange={setRoles} idPrefix="new-user-role" />
            </div>
          </fieldset>
          <div className="sm:col-span-2">
            <button type="submit" disabled={a.pending || !name || !email || roles.length === 0} className="btn btn-primary">
              Add user
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
