import Link from 'next/link';

/**
 * Shared bits for the M10 console screens (SME supply, certification, payments). Everything here uses the existing
 * console classes (.card, .pill-*, .btn-*); nothing adds a new visual style.
 */

/** Shown when an M10 list endpoint answers 404: the API has SME supply switched off (SME_SUPPLY_ENABLED). */
export function SupplyOff({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="card mt-6 max-w-xl p-6">
        <span className="pill pill-info">Not switched on</span>
        <h2 className="mt-3 text-lg font-semibold">SME supply is not switched on</h2>
        <p className="mt-2 text-sm text-fg-muted">
          Partners, certification and payments are turned off in this environment. Ask an Admin to set <code>SME_SUPPLY_ENABLED</code> on the API when you are ready to use them.
        </p>
        <Link href="/" className="btn btn-secondary mt-5">Go to your home page</Link>
      </div>
    </div>
  );
}

/** Loaded but not found (e.g. a stale link). */
export function NotFoundCard({ what, back, backLabel }: { what: string; back: string; backLabel: string }) {
  return (
    <div className="card mx-auto mt-6 max-w-xl p-6">
      <span className="pill pill-warning">Not found</span>
      <h1 className="mt-3 text-xl font-bold">We could not find this {what}</h1>
      <p className="mt-2 text-sm text-fg-muted">It may have been removed, or SME supply may be switched off. Go back and pick it again from the list.</p>
      <Link href={back} className="btn btn-primary mt-5">{backLabel}</Link>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-link hover:underline">
      ← {children}
    </Link>
  );
}

type Tone = 'info' | 'success' | 'warning' | 'error' | 'brand' | '';

const TONES: Record<string, Tone> = {
  // Generic
  ACTIVE: 'success',
  SUSPENDED: 'error',
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'error',
  DRAFT: 'info',
  APPROVED: 'success',
  PUBLISHED: 'brand',
  FLAGGED: 'error',
  // Requisitions
  OPEN: 'success',
  PAUSED: 'warning',
  FILLED: 'brand',
  CLOSED: '',
  // Submissions and screen
  RECEIVED: 'info',
  DUPLICATE: 'warning',
  INVITED: 'success',
  EXPIRED: '',
  WITHDRAWN: '',
  NOT_RUN: '',
  MEETS: 'success',
  DOES_NOT_MEET_RECOMMENDED: 'warning',
  UNCLEAR: 'warning',
  CONFIRMED_NOT_MET: 'error',
  // Generation runs
  QUEUED: 'info',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'error',
  // Certifications
  REVIEW_REQUIRED: 'warning',
  PASSED: 'success',
  NOT_CERTIFIED: 'error',
  RETAKE_AVAILABLE: 'info',
  // Payments
  CONFIRMED: 'info',
  SUBMITTED: 'brand',
  COMPLETED: 'success',
  CANCELLED: '',
  HELD: 'warning',
  PAID: 'success',
  RETURNED: 'error',
  RESOLVED: 'success',
};

const LABELS: Record<string, string> = {
  DOES_NOT_MEET_RECOMMENDED: 'Not met (recommended)',
  CONFIRMED_NOT_MET: 'Not met (confirmed)',
  NOT_RUN: 'Not screened',
  REVIEW_REQUIRED: 'Review required',
  RETAKE_AVAILABLE: 'Retake available',
  NOT_CERTIFIED: 'Not certified',
  VIA_PARTNER: 'Via partner',
  PARTNER_API: 'Partner API',
  PARTNER_PORTAL: 'Partner portal',
  REVIEWER_SME: 'Reviewer',
};

/** "DOES_NOT_MEET" → "Does not meet", with a few friendlier names. */
export const humanize = (s: string | null | undefined) => {
  if (!s) return '—';
  if (LABELS[s]) return LABELS[s];
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function StatePill({ state, label }: { state: string; label?: string }) {
  const tone = TONES[state] ?? '';
  return <span className={`pill ${tone ? `pill-${tone}` : ''}`}>{label ?? humanize(state)}</span>;
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
export const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : '—');

/** A definition list in the console's card style. */
export function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="card divide-y divide-line text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-2 px-4 py-2 sm:grid-cols-[12rem_1fr]">
          <dt className="font-medium text-fg-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Tabs as filter links, the same look as the Applications filter. */
export function FilterLinks({ label, items, current }: { label: string; items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap gap-2 text-sm">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={current === i.key ? 'page' : undefined} className={`rounded-full border px-3 py-1 ${current === i.key ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="card mt-6 p-4 text-sm text-fg-muted">{children}</p>;
}

export const TH = 'px-3 py-2 font-medium';
export const TD = 'px-3 py-2 align-top';
