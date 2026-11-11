import { roleLabel } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Home' };

type Tile = { label: string; count?: number; hint: string; href: string };

/** Console home: what is waiting for this person, by role, with a link straight to it. */
export default async function HomePage() {
  const user = (await getCurrentUser())!;
  const has = (r: string) => user.roles.includes(r as never);
  const count = async (path: string) => (await apiGet<{ items: unknown[] }>(path)).data?.items.length;
  const tiles: Tile[] = [];
  if (has('REVIEWER') || has('ADMIN')) {
    const [apps, tasks, rl] = await Promise.all([count('/review/enrollments'), count('/review/tasks'), count('/review/rl')]);
    tiles.push(
      { label: 'Applications to decide', count: apps, hint: 'Select experts for a pool, or ask for more information.', href: '/review/applications' },
      { label: 'Tasks to review', count: tasks, hint: 'Accept, request rework or reject submitted tasks.', href: '/review/tasks' },
      { label: 'RL reviews', count: rl, hint: 'Give verdicts on RL Gym results.', href: '/review/rl' },
    );
  }
  // SME -> Expert -> PM projects: a PM (who is not also a Validator) sees what waits for PM approval.
  if (has('PM') && !has('REVIEWER') && !has('ADMIN')) {
    tiles.push({ label: 'Tasks awaiting PM approval', count: await count('/review/tasks'), hint: 'Approve the exact version the Expert passed, or return it.', href: '/review/tasks' });
  }
  if (has('PM') || has('ADMIN')) {
    const projects = (await apiGet<{ items: { status: string }[] }>('/projects')).data?.items ?? [];
    tiles.push(
      { label: 'Projects staffing', count: projects.filter((p) => p.status === 'STAFFING' || p.status === 'READY_FOR_STAFFING').length, hint: 'Assign selected experts and launch sourcing.', href: '/projects' },
      { label: 'Projects in progress', count: projects.filter((p) => p.status === 'IN_PROGRESS' || p.status === 'STAFFED').length, hint: 'Follow coverage and accepted tasks.', href: '/projects' },
    );
  }
  // M10: only shown when SME supply is on (the endpoints answer 404 when it is off).
  if (has('REVIEWER') || has('ADMIN')) {
    const q = await apiGet<{ grading: { items: unknown[] }[]; certifications: unknown[] }>('/certifications/review-queue');
    if (q.data) tiles.push({ label: 'Certification reviews', count: q.data.grading.reduce((n, a) => n + a.items.length, 0) + q.data.certifications.length, hint: 'Confirm written grades, decide certifications and check licences.', href: '/certifications' });
  }
  if (has('FINANCE') || has('PM') || has('ADMIN')) {
    const runs = await apiGet<{ items: { status: string }[] }>('/pay-runs');
    if (runs.data) {
      const waiting = runs.data.items.filter((r) => ((has('ADMIN') || has('FINANCE')) && (r.status === 'CONFIRMED' || r.status === 'APPROVED')) || ((has('PM') || has('ADMIN')) && r.status === 'DRAFT')).length;
      tiles.push({ label: 'Pay runs waiting for you', count: waiting, hint: has('ADMIN') ? 'Release and submit weekly pay runs.' : has('FINANCE') ? 'Approve and submit confirmed weekly pay runs.' : 'Confirm drafted weekly pay runs.', href: '/payments/pay-runs' });
    }
  }
  if (has('FINANCE') || has('ADMIN')) {
    const ex = await apiGet<{ items: unknown[] }>('/payout-exceptions');
    if (ex.data) tiles.push({ label: 'Open payout exceptions', count: ex.data.items.length, hint: 'Resolve mismatches between the provider’s report and our payments.', href: '/payments/exceptions' });
  }
  if (has('ADMIN')) tiles.push({ label: 'Templates and users', hint: 'Manage workflow templates, taxonomy, terms and people.', href: '/templates' });

  return (
    <div className="space-y-8">
      <section className="hero p-6 sm:p-8">
        <p className="muted text-sm">{user.roles.map((r) => (r === 'PM' ? 'Program Manager' : roleLabel(r))).join(' · ')}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Welcome, {user.name.split(' ')[0]}</h1>
        <p className="muted mt-2 max-w-2xl">Experts write verified, synthetic tasks from your workflow templates; every selection and acceptance is made by a person.</p>
        {(has('ADMIN') || has('PM')) && (
          <Link href="/projects/new" className="btn mt-5 bg-white text-brand-navy shadow-lg hover:bg-white/90">
            New project →
          </Link>
        )}
      </section>
      {tiles.length === 0 && <p className="card p-5 text-sm text-fg-muted">Nothing is waiting for you right now.</p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link href={t.href} className="card card-link flex h-full flex-col p-5">
              <span className="text-sm font-medium text-fg-muted">{t.label}</span>
              {t.count !== undefined && <span className="mt-1 text-4xl font-bold tabular-nums">{t.count}</span>}
              <span className="mt-2 text-sm text-fg-muted">{t.hint}</span>
              <span className="mt-auto pt-3 text-sm font-semibold text-link">Open →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
