import { CANCELLABLE_STATUSES, type ProjectDto } from '@praxis/shared';
import Link from 'next/link';
import { CancelProjectButton } from '@/components/projects/cancel-button';
import { PauseResumeButton } from '@/components/projects/pause-resume';
import { ProjectStatusBadge } from '@/components/projects/project-status';
import { PROJECT_TABS, tabHref, type ProjectTab } from '@/lib/forge-console';

export const TH = 'px-4 py-2.5 text-xs font-semibold text-fg-muted';
export const TD = 'px-4 py-3 align-top';

/**
 * MVP1 project page (owner, 15 Nov): the header (back link, name, status, description, Pause, Cancel project) above
 * four tabs. Tabs are plain links (`?tab=`), so the page works without JavaScript.
 */
export function ForgeProjectShell({
  project: p,
  tab,
  counts,
  children,
}: {
  project: ProjectDto;
  tab: ProjectTab;
  counts: Partial<Record<ProjectTab, string>>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Link href="/projects" className="text-sm text-link hover:underline">
        ← Projects
      </Link>
      <div className="mt-2 flex flex-wrap items-start gap-3">
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <span className="mt-1.5">
          <ProjectStatusBadge status={p.status} />
        </span>
        <div className="ml-auto flex flex-wrap items-start gap-2 [&>div]:mt-0">
          {(p.status === 'IN_PROGRESS' || p.status === 'PAUSED') && <PauseResumeButton projectId={p.id} paused={p.status === 'PAUSED'} />}
          {CANCELLABLE_STATUSES.includes(p.status) && <CancelProjectButton projectId={p.id} />}
        </div>
      </div>
      {p.description && <p className="mt-1.5 max-w-3xl text-fg-muted">{p.description}</p>}
      <nav aria-label="Project" className="mt-7 mb-6 flex gap-1 overflow-x-auto border-b border-hairline">
        {PROJECT_TABS.map((t) => {
          const on = t.key === tab;
          return (
            <Link
              key={t.key}
              href={tabHref(p.id, t.key)}
              aria-current={on ? 'page' : undefined}
              data-tab={t.key}
              className={`-mb-px flex shrink-0 items-center gap-2 border-b-[3px] px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap ${on ? 'border-brand-blue text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
            >
              {t.label}
              {counts[t.key] && <span className="rounded-full bg-line/60 px-2 py-px font-mono text-[11px] tabular-nums">{counts[t.key]}</span>}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
