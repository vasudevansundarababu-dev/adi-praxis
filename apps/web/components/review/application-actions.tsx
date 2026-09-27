'use client';

import { CLAIM_REVIEW_LEVELS, CONTRIBUTION_ROLES, type ContributionRole } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5';
type Outcome = 'SELECTED' | 'NEEDS_INFORMATION' | 'NOT_SELECTED';
const OUTCOMES: [Outcome, string][] = [
  ['SELECTED', 'Select for this pool'],
  ['NEEDS_INFORMATION', 'Ask for more information'],
  ['NOT_SELECTED', 'Not selected for this pool'],
];
const MESSAGE_HINT: Record<Outcome, string> = {
  SELECTED: 'Welcome to the pool. Next, complete your onboarding checklist.',
  NEEDS_INFORMATION: 'Thank you. Before we decide, we need one more detail about your experience.',
  NOT_SELECTED: 'Thank you for applying. For this pool we need …. You can update your profile or request a review.',
};

interface Scope {
  domain: string;
  specialty: string;
  jurisdictions: string[];
  languages: string[];
  contributionRoles: ContributionRole[];
}

/** Decision, reopen, retry and conflict actions for one application (FLOW2 8.2). The reviewer decides; nothing is automatic. */
export function ApplicationActions(props: {
  id: string;
  status: string;
  assessmentFailed: boolean;
  criteria: { id: string; text: string }[];
  defaultScope: Scope;
  roleLabels: Record<ContributionRole, string>;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>('SELECTED');
  const [reason, setReason] = useState('');
  const [criterionId, setCriterionId] = useState('');
  const [message, setMessage] = useState('');
  const [infoRequest, setInfoRequest] = useState('');
  const [scope, setScope] = useState({ ...props.defaultScope, jurisdictions: props.defaultScope.jurisdictions.join(', '), languages: props.defaultScope.languages.join(', '), expiresAt: '' });
  const [conflict, setConflict] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function run(path: string, body: unknown) {
    setPending(true);
    setError(null);
    setProblems([]);
    const res = await mutate('POST', path, body);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      setProblems(res.problems ?? []);
      return false;
    }
    router.refresh();
    return true;
  }

  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const canDecide = props.status === 'REVIEW_PENDING';
  const valid = reason.trim() && message.trim() && (outcome !== 'NEEDS_INFORMATION' || infoRequest.trim()) && (outcome !== 'SELECTED' || (scope.domain.trim() && scope.contributionRoles.length > 0));

  return (
    <aside className="space-y-4" aria-label="Actions">
      {canDecide && (
        <form
          className="space-y-3 rounded-lg border border-line p-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void run(`/review/enrollments/${props.id}/decision`, {
              outcome,
              reasons: [{ criterionId: criterionId || null, text: reason }],
              candidateMessage: message,
              ...(outcome === 'NEEDS_INFORMATION' ? { informationRequest: infoRequest } : {}),
              ...(outcome === 'SELECTED'
                ? { scope: { domain: scope.domain, specialty: scope.specialty || null, jurisdictions: list(scope.jurisdictions), languages: list(scope.languages), contributionRoles: scope.contributionRoles, expiresAt: scope.expiresAt || null } }
                : {}),
            });
          }}
        >
          <h2 className="font-semibold">Your decision</h2>
          <fieldset className="space-y-1">
            <legend className="sr-only">Outcome</legend>
            {OUTCOMES.map(([v, label]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="outcome" value={v} checked={outcome === v} onChange={() => setOutcome(v)} />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="block">
            Reason (task-related, for the record)
            <textarea required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={input} />
          </label>
          <label className="block">
            Related criterion (optional)
            <select value={criterionId} onChange={(e) => setCriterionId(e.target.value)} className={input}>
              <option value="">None</option>
              {props.criteria.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.text}
                </option>
              ))}
            </select>
          </label>
          {outcome === 'NEEDS_INFORMATION' && (
            <label className="block">
              The one thing you need to know
              <input required value={infoRequest} onChange={(e) => setInfoRequest(e.target.value)} className={input} />
            </label>
          )}
          {outcome === 'SELECTED' && (
            <fieldset className="space-y-2 rounded-md border border-line p-3">
              <legend className="px-1 font-medium">Approved scope</legend>
              <label className="block">
                Domain
                <input value={scope.domain} onChange={(e) => setScope({ ...scope, domain: e.target.value })} className={input} />
              </label>
              <label className="block">
                Specialty
                <input value={scope.specialty} onChange={(e) => setScope({ ...scope, specialty: e.target.value })} className={input} />
              </label>
              <label className="block">
                Jurisdictions (comma-separated)
                <input value={scope.jurisdictions} onChange={(e) => setScope({ ...scope, jurisdictions: e.target.value })} className={input} />
              </label>
              <label className="block">
                Languages (comma-separated)
                <input value={scope.languages} onChange={(e) => setScope({ ...scope, languages: e.target.value })} className={input} />
              </label>
              <fieldset>
                <legend>Task roles</legend>
                {CONTRIBUTION_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={scope.contributionRoles.includes(r)}
                      onChange={(e) => setScope({ ...scope, contributionRoles: e.target.checked ? [...scope.contributionRoles, r] : scope.contributionRoles.filter((x) => x !== r) })}
                    />
                    {props.roleLabels[r]}
                  </label>
                ))}
              </fieldset>
              <label className="block">
                Re-review by (optional)
                <input type="date" value={scope.expiresAt} onChange={(e) => setScope({ ...scope, expiresAt: e.target.value })} className={input} />
              </label>
            </fieldset>
          )}
          <label className="block">
            Message to the candidate
            <textarea required value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder={MESSAGE_HINT[outcome]} className={input} />
            <span className="mt-1 block text-xs text-fg-muted">Respectful and specific to this pool. Never a judgement of the person.</span>
          </label>
          <button type="submit" disabled={pending || !valid} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-on-primary disabled:opacity-50">
            Record decision
          </button>
        </form>
      )}

      {props.status === 'SUBMITTED' && props.assessmentFailed && (
        <div className="space-y-2 rounded-lg border border-line p-4 text-sm">
          <h2 className="font-semibold">Assessment failed</h2>
          <button type="button" disabled={pending} onClick={() => run(`/review/enrollments/${props.id}/assessment/retry`, {})} className="w-full rounded-md border border-line px-3 py-2 disabled:opacity-50">
            Retry assessment
          </button>
          <button type="button" disabled={pending} onClick={() => run(`/review/enrollments/${props.id}/assessment/retry`, { withoutRecommendation: true })} className="w-full rounded-md border border-line px-3 py-2 disabled:opacity-50">
            Review without a recommendation
          </button>
        </div>
      )}
      {props.status === 'SUBMITTED' && !props.assessmentFailed && <p className="rounded-lg border border-line p-4 text-sm text-fg-muted">The assessment is running. Refresh in a moment.</p>}

      {props.status === 'REVIEW_REQUESTED' && (
        <div className="space-y-2 rounded-lg border border-line p-4 text-sm">
          <h2 className="font-semibold">Reconsider</h2>
          <p className="text-fg-muted">The earlier decision stays on record. Reopen for a new decision, or ask for more information.</p>
          <button type="button" disabled={pending} onClick={() => run(`/review/enrollments/${props.id}/reopen`, { to: 'REVIEW_PENDING' })} className="w-full rounded-md bg-primary px-3 py-2 text-on-primary disabled:opacity-50">
            Reopen for decision
          </button>
          <label className="block">
            Information needed
            <input value={infoRequest} onChange={(e) => setInfoRequest(e.target.value)} className={input} />
          </label>
          <button type="button" disabled={pending || !infoRequest.trim()} onClick={() => run(`/review/enrollments/${props.id}/reopen`, { to: 'NEEDS_INFORMATION', informationRequest: infoRequest })} className="w-full rounded-md border border-line px-3 py-2 disabled:opacity-50">
            Ask for more information
          </button>
        </div>
      )}

      <details className="rounded-lg border border-line p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Declare a conflict</summary>
        <p className="mt-2 text-fg-muted">If you know this candidate or have a conflict, declare it. You will no longer see this application.</p>
        <label className="mt-2 block">
          Details
          <input value={conflict} onChange={(e) => setConflict(e.target.value)} className={input} />
        </label>
        <button
          type="button"
          disabled={pending || !conflict.trim()}
          onClick={async () => {
            if (await run('/review/conflicts', { enrollmentId: props.id, details: conflict })) router.push('/review/applications');
          }}
          className="mt-2 rounded-md border border-line px-3 py-1.5 disabled:opacity-50"
        >
          Declare conflict
        </button>
      </details>

      {error && (
        <div role="alert" className="text-sm text-error">
          {error}
          {problems.length > 0 && (
            <ul className="list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

/** A reviewer records how far a credential claim is supported. Candidates and the model can only ever self-report. */
export function ClaimReview({ enrollmentId, claim }: { enrollmentId: string; claim: { id: string; type: string; value: string; evidenceLevel: string; method: string | null; evidenceIds: string[] } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<(typeof CLAIM_REVIEW_LEVELS)[number]>('DOCUMENT_SUPPORTED');
  const [method, setMethod] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{claim.value}</span>
        <span className="text-xs text-fg-muted">
          {claim.type.toLowerCase()} · {claim.evidenceLevel.toLowerCase().replace(/_/g, ' ')}
          {claim.method ? ` (${claim.method})` : ''} · {claim.evidenceIds.length} file(s) · claim:{claim.id.slice(0, 8)}
        </span>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="ml-auto text-link">
          Review claim
        </button>
      </div>
      {open && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await mutate('POST', `/review/claims/${claim.id}/verify`, { enrollmentId, evidenceLevel: level, method });
            if (!res.ok) return setError(res.error);
            setOpen(false);
            router.refresh();
          }}
        >
          <label>
            Level
            <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} className={input}>
              {CLAIM_REVIEW_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l.toLowerCase().replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1">
            How you checked
            <input required value={method} onChange={(e) => setMethod(e.target.value)} className={input} />
          </label>
          <button type="submit" disabled={!method.trim()} className="rounded-md border border-line px-3 py-1.5 disabled:opacity-50">
            Save
          </button>
          {error && <p role="alert" className="w-full text-error">{error}</p>}
        </form>
      )}
    </li>
  );
}
