'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';
import type { PayeeView } from '@/lib/supply-types';

const STATUS: Record<PayeeView['status'], [string, string, string]> = {
  NOT_REQUIRED: ['Not needed', '', 'The partner who put you forward pays you for this work, so there is nothing to set up here.'],
  NOT_STARTED: ['Not started', '', 'Set up your payment account with our payout provider. You add your tax form and payout method on their secure page; ADI Praxis never sees your bank or tax details.'],
  PENDING: ['Being checked', 'pill-info', 'The payout provider is checking your details. If you haven’t finished their form, open it again. This usually clears once the form is complete.'],
  READY: ['Ready', 'pill-success', 'Your payment account is ready. Payments for accepted work go out weekly.'],
  BLOCKED: ['Blocked', 'pill-error', 'Your payment account is blocked, so payouts are on hold. Contact support and we’ll help you sort it out.'],
};

/** Opens the provider's hosted onboarding (in a new tab) and re-checks the status when the candidate comes back. */
export function PayeeSetup({ initial, returned }: { initial: PayeeView; returned: boolean }) {
  const router = useRouter();
  const [payee, setPayee] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const checkedOnReturn = useRef(false);

  const refresh = useCallback(async () => {
    setPending(true);
    setError(null);
    const r = await call<PayeeView>('POST', '/me/payee/refresh');
    setPending(false);
    if (!r.ok) return setError(r.error);
    setPayee(r.data!);
    router.refresh();
  }, [router]);

  // Back from the provider (same tab), or back to this tab after finishing in the other one.
  useEffect(() => {
    if (returned && !checkedOnReturn.current) {
      checkedOnReturn.current = true;
      void refresh();
    }
  }, [returned, refresh]);
  useEffect(() => {
    if (!opened) return;
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [opened, refresh]);

  async function open() {
    setError(null);
    // Open the tab now (a click), then point it at the provider: a tab opened after a request is often blocked.
    const tab = window.open('', '_blank');
    setPending(true);
    const r = await call<{ url: string; status: string }>('POST', '/me/payee/onboarding-link');
    setPending(false);
    if (!r.ok) {
      tab?.close();
      return setError(r.error);
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = r.data!.url;
      setOpened(true);
      setPayee((p) => ({ ...p, status: p.status === 'NOT_STARTED' ? 'PENDING' : p.status }));
    } else window.location.assign(r.data!.url);
  }

  const [label, tone, body] = STATUS[payee.status];
  return (
    <section className="card p-5 text-sm" aria-labelledby="payee-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="payee-h" className="text-lg font-semibold">
          Payment set-up
        </h2>
        <span className={`pill ${tone}`}>{label}</span>
      </div>
      <p className="mt-2 text-fg-muted">{body}</p>
      {payee.reason && payee.status !== 'READY' && <p className="mt-2">Provider note: {payee.reason}</p>}
      {payee.status === 'READY' && payee.payoutCurrency && <p className="mt-2">You are paid in {payee.payoutCurrency}.</p>}
      {payee.required && payee.status !== 'BLOCKED' && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {payee.status !== 'READY' && (
            <button type="button" disabled={pending} onClick={open} className="btn btn-primary">
              {payee.status === 'NOT_STARTED' ? 'Set up payments' : 'Open the payout provider again'} →
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => void refresh()} className={payee.status === 'READY' ? 'btn btn-secondary' : 'text-link underline disabled:opacity-60'}>
            {pending ? 'Checking…' : 'Check my status'}
          </button>
        </div>
      )}
      {opened && payee.status !== 'READY' && <p className="mt-3 text-fg-muted">The payout provider opened in a new tab. When you’ve finished there, come back to this tab; we check your status automatically.</p>}
      {error && (
        <p role="alert" className="mt-3 text-error">
          {error}
        </p>
      )}
    </section>
  );
}
