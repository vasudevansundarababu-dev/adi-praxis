import Link from 'next/link';

/** Templates section header (S1-14): active workflow + version, and the Admin-only "Tasks DB & JSON" shortcut. */
export function McHeader({ isAdmin, active, children }: { isAdmin: boolean; active?: { workflowName: string; version: number; href?: string }; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-hairline pb-3 text-sm">
      <nav aria-label="Templates breadcrumb" className="flex min-w-0 flex-wrap items-center gap-2">
        <Link href="/templates" className="font-semibold text-link hover:underline">
          Harbor Templates
        </Link>
        {active && (
          <>
            <span aria-hidden className="text-fg-muted">/</span>
            {active.href ? (
              <Link href={active.href} className="truncate text-link hover:underline">
                {active.workflowName} <span className="text-fg-muted">v{active.version}</span>
              </Link>
            ) : (
              <span aria-current="page" className="truncate font-medium">
                {active.workflowName} <span className="text-fg-muted">v{active.version}</span>
              </span>
            )}
          </>
        )}
      </nav>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        {isAdmin && (
          <Link href="/templates/tasks" className="btn btn-secondary !px-3 !py-1.5 text-xs">
            Tasks DB &amp; JSON
          </Link>
        )}
      </div>
    </div>
  );
}
