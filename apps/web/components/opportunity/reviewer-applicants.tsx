'use client';

import { useState } from 'react';
import { mutate } from '@/lib/client-api';

export interface ReviewerApplicant {
  enrollmentId: string;
  name: string;
  email: string | null;
  status: string;
  identityVerified: boolean;
  expertUserId: string | null;
}

/**
 * Reviewer job post (owner, 12 Nov 2026): applicants go through the usual human selection; a SELECTED applicant with a
 * verified identity becomes the project's Expert (a Validator account assigned to the project).
 */
export function ReviewerApplicants({ projectId, initial }: { projectId: string; initial: ReviewerApplicant[] }) {
  const [items, setItems] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function makeExpert(a: ReviewerApplicant) {
    setPending(a.enrollmentId);
    const res = await mutate<{ userId: string; created: boolean; temporaryPassword?: string }>('POST', `/projects/${projectId}/reviewer-applicants/${a.enrollmentId}/make-expert`, {});
    setPending(null);
    if (!res.ok) return setMsg({ ok: false, text: res.error! });
    setItems((list) => list.map((x) => (x.enrollmentId === a.enrollmentId ? { ...x, expertUserId: res.data!.userId } : x)));
    setMsg({
      ok: true,
      text: res.data!.created
        ? `${a.name} is now this project’s Expert. Their Validator account was created; share this temporary password with them securely (shown once): ${res.data!.temporaryPassword}`
        : `${a.name} is now this project’s Expert.`,
    });
  }

  return (
    <section aria-label="Reviewer applicants" className="mt-8 max-w-3xl">
      <h2 className="text-lg font-semibold">Reviewer applicants</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Applicants are selected in the usual candidate review. A selected applicant with a verified identity can then become this project’s Expert. Creating their Validator
        account is an Admin step.
      </p>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${msg.ok ? '' : 'text-error'}`}>
          {msg.text}
        </p>
      )}
      {items.length === 0 ? (
        <p className="mt-3 text-sm">No reviewer applications yet.</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="py-2">Applicant</th>
              <th>Status</th>
              <th>Identity</th>
              <th>
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.enrollmentId} className="border-b border-line">
                <td className="py-2">
                  {a.name}
                  {a.email ? <span className="block text-fg-muted">{a.email}</span> : null}
                </td>
                <td>{a.status.replace(/_/g, ' ').toLowerCase()}</td>
                <td>{a.identityVerified ? 'verified' : 'not verified'}</td>
                <td>
                  {a.expertUserId ? (
                    'Expert on this project'
                  ) : a.status === 'SELECTED' && a.identityVerified ? (
                    <button type="button" className="btn btn-secondary" disabled={pending === a.enrollmentId} onClick={() => makeExpert(a)}>
                      Make Expert
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
