import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NextTaskButton } from '@/components/work/next-task';
import { getMe } from '@/lib/api';
import type { OutstandingStep, ProjectView } from '@/lib/work-types';
import { minutes, TASK_STATUS } from '@/lib/work-types';
import { cookies } from 'next/headers';

export const metadata: Metadata = { title: { absolute: pageTitle('Project tasks') } };

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';

/** The project's task list. If anything is missing, the screen names the outstanding step (SPEC FLOW 3). */
export default async function ProjectTasksPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const { id } = await params;
  const { submitted } = await searchParams;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/projects/${id}`)}`);
  const res = await fetch(`${API_BASE}/api/v1/me/projects/${id}`, { headers: { cookie: (await cookies()).toString() }, cache: 'no-store' });
  const body = (await res.json().catch(() => null)) as ProjectView | OutstandingStep | null;

  if (!res.ok) {
    const step = (body as OutstandingStep | null)?.details;
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-2xl font-semibold">One more step</h1>
        <p className="mt-3">{step?.message ?? 'This project is not available to you.'}</p>
        {step?.href && (
          <Link href={step.href} className="mt-6 inline-block btn btn-primary">
            Continue
          </Link>
        )}
      </main>
    );
  }
  const v = body as ProjectView;
  const open = v.tasks.filter((t) => ['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status));
  const rest = v.tasks.filter((t) => !open.includes(t));
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/home" className="text-sm text-link hover:underline">
        ← Home
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{v.project.name}</h1>
      <p className="text-sm text-fg-muted">
        {v.project.workflow} · {v.project.taskMode === 'AUTHORING' ? 'you write new tasks' : 'you work on supplied inputs'} · time target {v.project.tptMinutes ?? '—'} min per task
      </p>
      {v.project.status === 'PAUSED' && <p role="status" className="mt-4 rounded-md border border-warning p-3 text-sm">This project is paused. Your work is saved.</p>}
      {v.project.status === 'COMPLETED' && <p role="status" className="mt-4 rounded-md border border-success p-3 text-sm">This project is complete. Thank you.</p>}
      {submitted && <p role="status" className="mt-4 rounded-md border border-success p-3 text-sm">Submitted. A reviewer will look at it; you’ll see the outcome here.</p>}
      {v.project.humanGate && <p className="mt-4 text-sm"><span className="font-medium">Human gate: </span>{v.project.humanGate}</p>}

      <section className="mt-6" aria-labelledby="open-h">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="open-h" className="font-semibold">Your tasks</h2>
          <span className="text-sm text-fg-muted">
            {v.limits.open} of {v.limits.openCap} open
            {v.limits.perExpertCap ? ` · ${v.limits.used} of ${v.limits.perExpertCap} for this project` : ''}
          </span>
          <div className="ml-auto">
            <NextTaskButton projectId={v.project.id} disabled={!v.canPull} />
          </div>
        </div>
        {open.length === 0 && <p className="mt-2 text-sm text-fg-muted">No open tasks. {v.canPull ? 'Get your next task when you’re ready.' : ''}</p>}
        <ul className="mt-2 space-y-2">
          {[...open, ...rest].map((t) => (
            <li key={t.id} className="rounded-md border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/tasks/${t.id}`} className="font-medium text-link hover:underline">
                  {t.brief ?? 'Task'}
                </Link>
                <span className={`ml-auto text-xs ${t.status === 'REWORK' ? 'text-warning' : t.status === 'ACCEPTED' ? 'text-success' : 'text-fg-muted'}`}>{TASK_STATUS[t.status]}</span>
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                {t.isOpenSlot ? 'Open slot · ' : ''}active {minutes(t.activeSeconds)} min{t.submittedAt ? ` · submitted ${new Date(t.submittedAt).toLocaleDateString()}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
