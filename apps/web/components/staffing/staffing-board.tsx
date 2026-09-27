'use client';

import type { MatchesResponse, MatchItemDto } from '@praxis/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mutate } from '@/lib/client-api';
import { projectStatusLabel } from '../projects/project-status';

type Data = MatchesResponse & { warnings: string[] };
const POLL_MS = 15_000;

/** SPEC FLOW 2 Resource Assignment screen. */
export function StaffingBoard({ projectId, initial }: { projectId: string; initial: Data }) {
  const [data, setData] = useState<Data>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [topN, setTopN] = useState(String(Math.max(1, initial.shortfall)));
  const [minScore, setMinScore] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'score' | 'name'>('score');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; problems?: string[] } | null>(null);
  const opened = useRef(false);

  const run = useCallback(async (method: 'POST', path: string, body?: unknown, ok?: string) => {
    setPending(true);
    const res = await mutate<Data>(method, path, body);
    setPending(false);
    if (!res.ok) {
      setMessage({ kind: 'error', text: res.error!, problems: res.problems });
      return false;
    }
    setData(res.data!);
    setSelected(new Set());
    if (ok) setMessage({ kind: 'ok', text: ok });
    return true;
  }, []);

  // Opening a READY_FOR_STAFFING project starts staffing and runs the first match (SPEC FLOW 2).
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (initial.status === 'READY_FOR_STAFFING' || (initial.status === 'STAFFING' && !initial.matchedAt)) {
      void run('POST', `/projects/${projectId}/match`);
    }
  }, [initial, projectId, run]);

  // Poll while staffing, so newly approved applicants appear without a manual refresh.
  useEffect(() => {
    if (data.status !== 'STAFFING') return;
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const res = await fetch(`/api/v1/projects/${projectId}/matches`);
      if (res.ok) setData((await res.json()) as Data);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [data.status, projectId]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = minScore === '' ? -1 : Number(minScore);
    const list = data.items.filter(
      (i) => i.score >= min && (!q || i.name.toLowerCase().includes(q) || i.skills.some((s) => s.toLowerCase().includes(q))),
    );
    return sort === 'score' ? list : [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.items, query, minScore, sort]);

  const staffing = data.status === 'STAFFING';
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  return (
    <div>
      <Link href={`/projects/${projectId}`} className="text-sm text-link hover:underline">
        ← Project
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Resource assignment · {data.projectName}</h1>

      <dl className="mt-4 grid gap-3 sm:grid-cols-4">
        {(
          [
            ['Status', projectStatusLabel(data.status as never)],
            ['Required workers', data.requiredWorkers ?? '—'],
            ['Assigned', data.assigned],
            ['Shortfall', data.shortfall],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface p-3">
            <dt className="text-sm text-fg-muted">{k}</dt>
            <dd className="text-xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {data.status === 'STAFFED' && (
        <p role="status" className="mt-4 rounded-md border border-success p-3 text-sm">
          This project is fully staffed. Assigned candidates are listed below.
        </p>
      )}
      {data.warnings.map((w) => (
        <p key={w} role="status" className="mt-4 rounded-md border border-warning p-3 text-sm text-warning">
          {w}
        </p>
      ))}

      {staffing && (
        <div className="mt-6 flex flex-wrap items-end gap-3">
          <button type="button" disabled={pending} onClick={() => run('POST', `/projects/${projectId}/match`, undefined, 'Match re-run.')} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-60">
            Re-run match
          </button>
          <label className="text-sm">
            <span className="block">Assign top</span>
            <input type="number" min={1} value={topN} onChange={(e) => setTopN(e.target.value)} className="w-20 rounded-md border border-line bg-surface px-2 py-1.5" />
          </label>
          <button type="button" disabled={pending || !Number(topN)} onClick={() => run('POST', `/projects/${projectId}/assignments`, { topN: Number(topN) }, `Assigned the top ${topN}.`)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-on-primary disabled:opacity-60">
            Assign top {topN || 'N'}
          </button>
          <button type="button" disabled={pending || selected.size === 0} onClick={() => run('POST', `/projects/${projectId}/assignments`, { candidateIds: [...selected] }, `Assigned ${selected.size}.`)} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-60">
            Assign selected ({selected.size})
          </button>
        </div>
      )}
      {message && (
        <div role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${message.kind === 'error' ? 'text-error' : 'text-success'}`}>
          <p>{message.kind === 'error' && message.problems ? 'Could not assign:' : message.text}</p>
          {message.problems && (
            <ul className="list-disc pl-5 text-fg">
              {message.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="block">Search name or skill</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1.5" />
        </label>
        <label>
          <span className="block">Minimum score</span>
          <input type="number" min={0} max={110} value={minScore} onChange={(e) => setMinScore(e.target.value)} className="w-24 rounded-md border border-line bg-surface px-2 py-1.5" />
        </label>
        <label>
          <span className="block">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as 'score' | 'name')} className="rounded-md border border-line bg-surface px-2 py-1.5">
            <option value="score">Match score</option>
            <option value="name">Name</option>
          </select>
        </label>
        <span className="ml-auto text-fg-muted">
          {items.length} of {data.items.length} shown{data.matchedAt ? ` · matched ${new Date(data.matchedAt).toLocaleString()}` : ''}
        </span>
      </div>

      {data.items.length === 0 ? (
        <p className="mt-6 text-fg-muted">No candidates match yet. Adjust the project’s filters or re-run the match later.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface">
              <tr>
                {staffing && <th className="px-3 py-2"><span className="sr-only">Select</span></th>}
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Key skills</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Languages</th>
                <th className="px-3 py-2 font-medium">Availability</th>
                <th className="px-3 py-2 font-medium">Last validated</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {staffing && <th className="px-3 py-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <Row
                  key={i.candidateId}
                  item={i}
                  staffing={staffing}
                  pending={pending}
                  selected={selected.has(i.candidateId)}
                  onToggle={() => toggle(i.candidateId)}
                  expanded={expanded === i.candidateId}
                  onExpand={() => setExpanded(expanded === i.candidateId ? null : i.candidateId)}
                  onAssign={() => run('POST', `/projects/${projectId}/assignments`, { candidateIds: [i.candidateId] }, `Assigned ${i.name}.`)}
                  onRelease={() => fetchRelease(projectId, i.assignmentId!, setData, setMessage, setPending)}
                  rejecting={rejecting === i.candidateId}
                  onStartReject={() => {
                    setRejecting(i.candidateId);
                    setReason('');
                  }}
                  reason={reason}
                  onReason={setReason}
                  onConfirmReject={async () => {
                    if (await run('POST', `/projects/${projectId}/rejections`, { candidateId: i.candidateId, reason: reason.trim() || undefined }, `Rejected ${i.name} for this project.`)) setRejecting(null);
                  }}
                  onCancelReject={() => setRejecting(null)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function fetchRelease(
  projectId: string,
  assignmentId: string,
  setData: (d: Data) => void,
  setMessage: (m: { kind: 'ok' | 'error'; text: string }) => void,
  setPending: (p: boolean) => void,
) {
  setPending(true);
  const res = await fetch(`/api/v1/projects/${projectId}/assignments/${assignmentId}`, {
    method: 'DELETE',
    headers: { 'idempotency-key': crypto.randomUUID() },
  });
  setPending(false);
  const body = await res.json().catch(() => null);
  if (!res.ok) return setMessage({ kind: 'error', text: body?.message ?? 'Release failed' });
  setData(body as Data);
  setMessage({ kind: 'ok', text: 'Assignment released.' });
}

function Row(props: {
  item: MatchItemDto;
  staffing: boolean;
  pending: boolean;
  selected: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
  onAssign: () => void;
  onRelease: () => void;
  rejecting: boolean;
  onStartReject: () => void;
  reason: string;
  onReason: (s: string) => void;
  onConfirmReject: () => void;
  onCancelReject: () => void;
}) {
  const { item: i, staffing, pending } = props;
  const b = i.breakdown;
  const cols = staffing ? 11 : 9;
  return (
    <>
      <tr className="border-t border-line align-top">
        {staffing && (
          <td className="px-3 py-2">
            {i.status === 'AVAILABLE' && <input type="checkbox" aria-label={`Select ${i.name}`} checked={props.selected} onChange={props.onToggle} />}
          </td>
        )}
        <td className="px-3 py-2 tabular-nums">{i.rank}</td>
        <td className="px-3 py-2">
          <Link href={`/candidates/${i.candidateId}`} className="text-link hover:underline">
            {i.name}
          </Link>
        </td>
        <td className="px-3 py-2">
          <button type="button" onClick={props.onExpand} aria-expanded={props.expanded} className="font-medium tabular-nums text-link" title="Show score breakdown">
            {i.score.toFixed(1)}
          </button>
        </td>
        <td className="px-3 py-2">{i.skills.slice(0, 4).join(', ')}</td>
        <td className="px-3 py-2">{[i.city, i.country].filter(Boolean).join(', ') || '—'}</td>
        <td className="px-3 py-2">{i.languages.map((l) => `${l.language} ${l.level}`).join(', ') || '—'}</td>
        <td className="px-3 py-2">{i.hoursPerWeek ? `${i.hoursPerWeek} h/wk` : '—'}{i.timezone ? <span className="block text-xs text-fg-muted">{i.timezone}</span> : null}</td>
        <td className="px-3 py-2">{i.lastValidatedAt ? new Date(i.lastValidatedAt).toLocaleDateString() : '—'}</td>
        <td className="px-3 py-2">{i.status === 'ASSIGNED' ? <span className="font-medium text-success">Assigned</span> : 'Available'}</td>
        {staffing && (
          <td className="whitespace-nowrap px-3 py-2">
            {i.status === 'ASSIGNED' ? (
              <button type="button" disabled={pending} onClick={props.onRelease} className="text-link disabled:opacity-60">
                Release
              </button>
            ) : (
              <>
                <button type="button" disabled={pending} onClick={props.onAssign} className="text-link disabled:opacity-60">
                  Assign
                </button>
                <span className="px-1 text-fg-muted">·</span>
                <button type="button" disabled={pending} onClick={props.onStartReject} className="text-link disabled:opacity-60">
                  Reject
                </button>
              </>
            )}
          </td>
        )}
      </tr>
      {props.expanded && (
        <tr className="bg-surface">
          <td colSpan={cols} className="px-3 py-2 text-xs">
            Skills {b.skills}/50 · Experience {b.experience}/20 · Language {b.language}/15 · Availability {b.availability}/15 · Preferred filters {b.preferredBonus}/10
            {b.preferredMissed.length > 0 && <span className="text-fg-muted"> (not met: {b.preferredMissed.join(', ')})</span>}
          </td>
        </tr>
      )}
      {props.rejecting && (
        <tr className="bg-surface">
          <td colSpan={cols} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor={`reason-${i.candidateId}`}>Reason (optional, for this project only):</label>
              <input id={`reason-${i.candidateId}`} value={props.reason} onChange={(e) => props.onReason(e.target.value)} className="min-w-60 flex-1 rounded-md border border-line bg-bg px-2 py-1" />
              <button type="button" disabled={pending} onClick={props.onConfirmReject} className="rounded-md border border-error px-3 py-1 text-error disabled:opacity-60">
                Reject for this project
              </button>
              <button type="button" onClick={props.onCancelReject} className="rounded-md border border-line px-3 py-1">
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
