/**
 * Live extraction progress (PRD PR-E15). Pure helpers so the polling rules are unit-tested without a browser:
 * the Extract panel polls GET /policy/extraction while any job is not terminal and stops once all are.
 */

export interface ProgressJob {
  status: string;
  candidateCount: number;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  submitted?: boolean;
}

/** Statuses after which the worker never changes a job again. */
export const TERMINAL = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'UNCERTAIN']);

export const POLL_INTERVAL_MS = 3000;
/** The worker gives up after 30 minutes (PRD section 7); polling a little longer covers clock skew, then stops. */
export const POLL_GIVE_UP_MS = 35 * 60 * 1000;

export function isActive(jobs: ProgressJob[]): boolean {
  return jobs.some((j) => !TERMINAL.has(j.status));
}

/** Short, plain stage for one job: Queued → Running (submitting / waiting for the provider) → a final state. */
export function stageLabel(j: ProgressJob): string {
  switch (j.status) {
    case 'QUEUED':
      return 'Queued';
    case 'PROCESSING':
      return j.submitted ? 'Running — waiting for the provider' : 'Running — sending to the provider';
    case 'SUCCEEDED':
      return 'Succeeded';
    case 'PARTIAL':
      return 'Partial — some output unreadable';
    case 'FAILED':
      return 'Failed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'UNCERTAIN':
      return 'Uncertain — not resubmitted';
    default:
      return j.status;
  }
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Elapsed time from when the job was queued, to now while it runs, or to when it finished. Null when unknown. */
export function elapsed(j: ProgressJob, now: number): string | null {
  const from = j.createdAt ?? j.startedAt;
  if (!from) return null;
  const end = TERMINAL.has(j.status) ? (j.finishedAt ? Date.parse(j.finishedAt) : null) : now;
  if (end === null) return null;
  return formatDuration(end - Date.parse(from));
}

/**
 * Polls `fetchOnce` every `intervalMs` while any job is not terminal. Calls `onUpdate` with every fresh result and
 * `onDone` once when all jobs are terminal. A failed fetch is retried on the next tick; polling stops after
 * `giveUpMs` or when `signal` aborts (the component unmounts).
 */
export async function pollExtraction<T extends { batches: Array<{ jobs: ProgressJob[] }> }>(opts: {
  fetchOnce: () => Promise<T | null>;
  onUpdate: (d: T) => void;
  onDone: (d: T) => void;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  giveUpMs?: number;
  now?: () => number;
  signal?: { aborted: boolean };
}): Promise<'done' | 'aborted' | 'gave_up'> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const start = now();
  for (;;) {
    await sleep(opts.intervalMs ?? POLL_INTERVAL_MS);
    if (opts.signal?.aborted) return 'aborted';
    const d = await opts.fetchOnce().catch(() => null);
    if (opts.signal?.aborted) return 'aborted';
    if (d) {
      opts.onUpdate(d);
      if (!isActive(d.batches.flatMap((b) => b.jobs))) {
        opts.onDone(d);
        return 'done';
      }
    }
    if (now() - start > (opts.giveUpMs ?? POLL_GIVE_UP_MS)) return 'gave_up';
  }
}
