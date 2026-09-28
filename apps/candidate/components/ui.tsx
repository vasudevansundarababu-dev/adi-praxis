import Link from 'next/link';

/** Candidate-facing application states, as a coloured pill (Bold brand refresh). */
const ENROLLMENT: Record<string, [string, string]> = {
  DRAFT: ['Profile in progress', 'pill-info'],
  SUBMITTED: ['Submitted', 'pill-info'],
  REVIEW_PENDING: ['With a Validator', 'pill-info'],
  NEEDS_INFORMATION: ['More information requested', 'pill-warning'],
  SELECTED: ['Selected', 'pill-success'],
  NOT_SELECTED: ['Not selected this time', ''],
  REVIEW_REQUESTED: ['Review requested', 'pill-info'],
  WITHDRAWN: ['Withdrawn', ''],
};
export function StatusPill({ status }: { status: string }) {
  const [label, tone] = ENROLLMENT[status] ?? [status.toLowerCase().replace(/_/g, ' '), ''];
  return <span className={`pill ${tone}`}>{label}</span>;
}

export const JOURNEY = ['Verify identity', 'Build profile', 'Reviewer decision', 'Onboarding', 'Assignment', 'Write tasks'] as const;

/** Where the candidate is in the journey: steps before `current` are done. */
export function Journey({ current, className = '' }: { current: number; className?: string }) {
  return (
    <ol className={`stepper ${className}`} aria-label="Your progress">
      {JOURNEY.map((s, i) => (
        <li key={s} data-state={i < current ? 'done' : i === current ? 'current' : 'todo'} aria-current={i === current ? 'step' : undefined}>
          <span className="dot" aria-hidden>{i < current ? '✓' : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function NextStep({ title, body, href, cta }: { title: string; body?: string; href?: string; cta?: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Next step</p>
        <p className="mt-1 text-lg font-semibold">{title}</p>
        {body && <p className="muted mt-1 text-sm">{body}</p>}
      </div>
      {href && cta && (
        <Link href={href} className="btn bg-white text-brand-navy shadow-lg hover:bg-white/90">
          {cta} →
        </Link>
      )}
    </div>
  );
}
