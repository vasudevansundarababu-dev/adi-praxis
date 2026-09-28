'use client';

import { LAUNCH_DOMAINS, SME_TIERS, TIER_LABELS, type SmeTier } from '@praxis/shared';
import { useState } from 'react';
import { ActionMessages, input, splitList, useAction } from './action';
import type { PartnerContact, PartnerDetail } from './types';

type Verification = 'PENDING' | 'VERIFIED' | 'REJECTED';

function TierBoxes({ value, onChange }: { value: SmeTier[]; onChange: (v: SmeTier[]) => void }) {
  return (
    <fieldset>
      <legend>Tiers this partner may supply (none ticked = any)</legend>
      <div className="mt-1 flex flex-wrap gap-4">
        {SME_TIERS.map((t) => (
          <label key={t} className="flex items-center gap-2">
            <input type="checkbox" checked={value.includes(t)} onChange={(e) => onChange(e.target.checked ? [...value, t] : value.filter((x) => x !== t))} />
            {TIER_LABELS[t]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ContactRows({ value, onChange }: { value: PartnerContact[]; onChange: (v: PartnerContact[]) => void }) {
  const set = (i: number, patch: Partial<PartnerContact>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <fieldset className="space-y-2">
      <legend>Contacts</legend>
      {value.map((c, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input aria-label="Contact name" placeholder="Name" value={c.name} onChange={(e) => set(i, { name: e.target.value })} className={input} />
          <input aria-label="Contact email" type="email" placeholder="Email" value={c.email} onChange={(e) => set(i, { email: e.target.value })} className={input} />
          <input aria-label="Contact role" placeholder="Role (optional)" value={c.role ?? ''} onChange={(e) => set(i, { role: e.target.value })} className={input} />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-link">
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { name: '', email: '', role: '' }])} className="text-link">
        + Add a contact
      </button>
    </fieldset>
  );
}

const cleanContacts = (list: PartnerContact[]) => list.filter((c) => c.name.trim() && c.email.trim()).map((c) => ({ name: c.name.trim(), email: c.email.trim(), ...(c.role?.trim() ? { role: c.role.trim() } : {}) }));

/** Admin onboards a partner (section 5). OAuth clients and webhooks are set up by the partner in its portal. */
export function NewPartnerForm() {
  const a = useAction();
  const [name, setName] = useState('');
  const [verification, setVerification] = useState<Verification>('PENDING');
  const [domains, setDomains] = useState('');
  const [tiers, setTiers] = useState<SmeTier[]>([]);
  const [contacts, setContacts] = useState<PartnerContact[]>([{ name: '', email: '', role: '' }]);
  const [feeTermsVersion, setFeeTermsVersion] = useState('');
  return (
    <form
      className="card mt-6 max-w-3xl space-y-3 p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await a.run('POST', '/partners', { name, businessVerification: verification, allowedDomains: splitList(domains).map((d) => d.toLowerCase()), allowedTiers: tiers, contacts: cleanContacts(contacts), feeTermsVersion: feeTermsVersion.trim() || null }, { success: `${name} added. Open it to add portal users and fee terms.` });
        if (res.ok) {
          setName('');
          setDomains('');
          setTiers([]);
          setContacts([{ name: '', email: '', role: '' }]);
          setFeeTermsVersion('');
        }
      }}
    >
      <h2 className="font-semibold">Add a partner</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          Partner name
          <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="block">
          Business check
          <select value={verification} onChange={(e) => setVerification(e.target.value as Verification)} className={input}>
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <label className="block">
          Domains (comma-separated, blank = any)
          <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={LAUNCH_DOMAINS.join(', ')} className={input} />
        </label>
        <label className="block">
          Fee terms version (optional)
          <input value={feeTermsVersion} onChange={(e) => setFeeTermsVersion(e.target.value)} placeholder="e.g. 2026-10" className={input} />
        </label>
      </div>
      <TierBoxes value={tiers} onChange={setTiers} />
      <ContactRows value={contacts} onChange={setContacts} />
      <button type="submit" disabled={a.pending || name.trim().length < 2} className="btn btn-primary">
        Add partner
      </button>
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </form>
  );
}

/** Status, business check, domains, tiers and contacts. Suspending a partner ends its API tokens at once. */
export function PartnerSettings({ partner }: { partner: PartnerDetail }) {
  const a = useAction();
  const [verification, setVerification] = useState<Verification>(partner.businessVerification);
  const [domains, setDomains] = useState(partner.allowedDomains.join(', '));
  const [tiers, setTiers] = useState<SmeTier[]>(partner.allowedTiers);
  const [contacts, setContacts] = useState<PartnerContact[]>(partner.contacts);
  const suspended = partner.status === 'SUSPENDED';
  return (
    <section className="card space-y-3 p-4 text-sm">
      <h2 className="font-semibold">Settings</h2>
      <label className="block">
        Business check
        <select value={verification} onChange={(e) => setVerification(e.target.value as Verification)} className={input}>
          <option value="PENDING">Pending</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      <label className="block">
        Domains (comma-separated, blank = any)
        <input value={domains} onChange={(e) => setDomains(e.target.value)} className={input} />
      </label>
      <TierBoxes value={tiers} onChange={setTiers} />
      <ContactRows value={contacts} onChange={setContacts} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={a.pending}
          onClick={() => a.run('PATCH', `/partners/${partner.id}`, { businessVerification: verification, allowedDomains: splitList(domains).map((d) => d.toLowerCase()), allowedTiers: tiers, contacts: cleanContacts(contacts) }, { success: 'Settings saved.' })}
          className="btn btn-primary"
        >
          Save settings
        </button>
        <button
          type="button"
          disabled={a.pending}
          onClick={() => a.run('PATCH', `/partners/${partner.id}`, { status: suspended ? 'ACTIVE' : 'SUSPENDED' }, { success: suspended ? 'Partner reactivated.' : 'Partner suspended. Its API tokens were ended.' })}
          className="btn btn-secondary"
        >
          {suspended ? 'Reactivate partner' : 'Suspend partner'}
        </button>
      </div>
      {!suspended && <p className="text-xs text-fg-muted">Suspending ends every API token at once; the partner can no longer submit candidates.</p>}
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </section>
  );
}

/** Certified-candidate fee (section 8.1). Each certified candidate creates one fee entry at these terms. */
export function FeeTermsForm({ partnerId, currentVersion }: { partnerId: string; currentVersion: string | null }) {
  const a = useAction();
  const [fee, setFee] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'INR'>('USD');
  const [version, setVersion] = useState('');
  const valid = /^\d{1,8}(\.\d{1,2})?$/.test(fee) && version.trim();
  return (
    <form
      className="card space-y-3 p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await a.run('PUT', `/partners/${partnerId}/fee-terms`, { certifiedFee: fee, feeCurrency: currency, feeTermsVersion: version.trim() }, { success: 'Fee terms saved. New certified-candidate fees use them.' });
        if (res.ok) setFee('');
      }}
    >
      <h2 className="font-semibold">Fee terms</h2>
      <p className="text-fg-muted">
        Current version: <span className="font-medium text-fg">{currentVersion ?? 'none'}</span>. Setting new terms applies to candidates certified from now on; earlier fee entries keep their terms.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          Fee per certified candidate
          <input required inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="150.00" className={input} />
        </label>
        <label className="block">
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'INR')} className={input}>
            <option value="USD">USD</option>
            <option value="INR">INR</option>
          </select>
        </label>
        <label className="block">
          Terms version
          <input required value={version} onChange={(e) => setVersion(e.target.value)} placeholder="2026-10" className={input} />
        </label>
      </div>
      <button type="submit" disabled={a.pending || !valid} className="btn btn-primary">
        Save fee terms
      </button>
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </form>
  );
}

/** A portal user for the partner, with an initial password the Admin passes on securely. */
export function PartnerUserForm({ partnerId }: { partnerId: string }) {
  const a = useAction();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form
      className="mt-4 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await a.run('POST', `/partners/${partnerId}/users`, { name, email, password }, { success: `${email} can now sign in to the partner portal. Share the password through a secure channel.` });
        if (res.ok) {
          setName('');
          setEmail('');
          setPassword('');
        }
      }}
    >
      <label className="block">
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} className={input} />
      </label>
      <label className="block">
        Email
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      </label>
      <label className="block">
        Initial password (12+ characters)
        <input required type="password" minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </label>
      <button type="submit" disabled={a.pending || password.length < 12} className="btn btn-primary">
        Add user
      </button>
      <div className="sm:col-span-4">
        <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
      </div>
    </form>
  );
}
