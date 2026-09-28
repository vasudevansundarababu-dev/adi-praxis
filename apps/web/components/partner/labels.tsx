/** Plain-language labels and pill colours for partner-visible states (docs/SME-SUPPLY.md section 6). */

export const DIMENSIONS: { key: string; label: string }[] = [
  { key: 'submission', label: 'Submission' },
  { key: 'screen', label: 'Requirement screen' },
  { key: 'invite', label: 'Invite' },
  { key: 'identity', label: 'Identity' },
  { key: 'selection', label: 'Selection' },
  { key: 'certification', label: 'Certification' },
  { key: 'standing', label: 'Standing' },
];

export const dimensionLabel = (d: string) => DIMENSIONS.find((x) => x.key === d)?.label ?? d.charAt(0).toUpperCase() + d.slice(1);

const STATE_LABELS: Record<string, string> = {
  NOT_RUN: 'Not run',
  MEETS: 'Meets requirements',
  DOES_NOT_MEET_RECOMMENDED: 'May not meet (Validator to decide)',
  UNCLEAR: 'Unclear (Validator to decide)',
  CONFIRMED_NOT_MET: 'Not met (confirmed)',
  NOT_STARTED: 'Not started',
  IN_TRAINING: 'In training',
  TEST_READY: 'Ready for test',
  IN_TEST: 'In test',
  RETAKE_AVAILABLE: 'Retake available',
  REVIEW_REQUIRED: 'Human review',
  NOT_CERTIFIED: 'Not certified',
  NOT_SELECTED: 'Not selected',
};

export const stateLabel = (s: string) => STATE_LABELS[s] ?? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

const SUCCESS = ['MEETS', 'INVITED', 'ACCEPTED', 'VERIFIED', 'SELECTED', 'PASSED', 'CERTIFIED', 'ACTIVE', 'DELIVERED', 'OPEN', 'ISSUED', 'PAID'];
const WARNING = ['DOES_NOT_MEET_RECOMMENDED', 'UNCLEAR', 'RETAKE_AVAILABLE', 'REVIEW_REQUIRED', 'PROBATION', 'RETRAINING', 'PAUSED', 'PENDING', 'SENDING', 'EXPIRED'];
const ERROR = ['DUPLICATE', 'CONFIRMED_NOT_MET', 'NOT_CERTIFIED', 'NOT_SELECTED', 'SUSPENDED', 'OFFBOARDED', 'FAILED', 'REJECTED', 'REVOKED', 'DISABLED'];

export function pillClass(s: string) {
  if (SUCCESS.includes(s)) return 'pill pill-success';
  if (WARNING.includes(s)) return 'pill pill-warning';
  if (ERROR.includes(s)) return 'pill pill-error';
  if (s === 'WITHDRAWN' || s === 'CLOSED' || s === 'FILLED') return 'pill';
  return 'pill pill-info';
}

export function StatePill({ state, label }: { state: string; label?: string }) {
  return <span className={pillClass(state)}>{label ?? stateLabel(state)}</span>;
}

export function EnvPill({ env }: { env: string }) {
  return env === 'LIVE' ? <span className="pill pill-brand">Live</span> : <span className="pill pill-warning">Sandbox</span>;
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function fmtPeriod(period: string) {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function fmtMoney(amount: string, currency: string) {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}
