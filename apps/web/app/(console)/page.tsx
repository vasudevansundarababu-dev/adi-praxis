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
  if (has('PM') || has('ADMIN')) {
    const projects = (await apiGet<{ items: { status: string }[] }>('/projects')).data?.items ?? [];
    tiles.push(
      { label: 'Projects staffing', count: projects.filter((p) => p.status === 'STAFFING' || p.status === 'READY_FOR_STAFFING').length, hint: 'Assign selected experts and launch sourcing.', href: '/projects' },
      { label: 'Projects in progress', count: projects.filter((p) => p.status === 'IN_PROGRESS' || p.status === 'STAFFED').length, hint: 'Follow coverage and accepted tasks.', href: '/projects' },
    );
  }
  if (has('ADMIN')) tiles.push({ label: 'Templates and users', hint: 'Manage workflow templates, taxonomy, terms and people.', href: '/templates' });

  return (
    <div className="space-y-8">
      <section className="hero p-6 sm:p-8">
        <p className="muted text-sm">{user.roles.map((r) => (r === 'PM' ? 'Program Manager' : r[0] + r.slice(1).toLowerCase())).join(' · ')}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Welcome, {user.name.split(' ')[0]}</h1>
        <p className="muted mt-2 max-w-2xl">Experts write verified, synthetic tasks from your workflow templates; every selection and acceptance is made by a person.</p>
        {has('PM') && (
          <Link href="/projects/new" className="btn mt-5 bg-white text-brand-navy shadow-lg hover:bg-white/90">
            New project →
          </Link>
        )}
      </section>
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
