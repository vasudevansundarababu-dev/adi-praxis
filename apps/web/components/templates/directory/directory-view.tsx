import type { DirectoryRowDto, TemplateDirectoryResponse } from '@praxis/shared';
import { BLUEPRINT_SECTIONS } from '@praxis/shared';
import Link from 'next/link';
import { TableSearch } from '@/components/search/table-search';
import { directoryHref, filterDomains, modesText, STATUS_PILLS, tptText, versionLabel } from '@/lib/mc/format';

/** Screen 1: Templates & Active SME Applications Directory (S1-01 to S1-15). Server-rendered; filters live in the URL. */
export function DirectoryView({ data, domainFilter }: { data: TemplateDirectoryResponse; domainFilter?: string }) {
  const isAdmin = data.view === 'ADMIN';
  const { selected, domains } = filterDomains(data, domainFilter);
  const s = data.summary;
  const cards: Array<[string, string]> = isAdmin
    ? [
        ['Total Templates', String(s.totalTemplates)],
        ['Active SME Studios', String(s.activeStudios)],
        ['Attached Projects & SMEs', `${s.attachedProjects} / ${s.attachedSmes}`],
        ['Authored Tasks', String(s.authoredTasks)],
      ]
    : [['Published Templates', String(s.totalTemplates)]];

  return (
    <div>
      <ul aria-label="Summary" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <li key={label} className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold" data-testid={`summary-${label}`}>
              {value}
            </p>
          </li>
        ))}
      </ul>

      <nav aria-label="Filter by domain" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link href={directoryHref(null)} className={pillClass(selected === null)} aria-current={selected === null ? 'true' : undefined}>
              All
            </Link>
          </li>
          {data.domains.map((d) => (
            <li key={d.domainId}>
              <Link
                href={directoryHref(d.domainId)}
                className={pillClass(selected === d.domainId)}
                aria-current={selected === d.domainId ? 'true' : undefined}
              >
                {d.domainName} <span className="text-fg-muted">{d.rows.length}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6"><TableSearch type="templates" label="Search templates" placeholder="Search templates by workflow, domain or skills" /></div>
      <div data-search-scope="templates">
      {domains.map((d) => (
        <section key={d.domainId} aria-labelledby={`domain-${d.domainId}`} className="mt-8">
          <h2 id={`domain-${d.domainId}`} className="flex items-center gap-2 text-lg font-semibold">
            {d.domainName}
            <span className="pill" aria-label={`${d.rows.length} workflows`}>
              {d.rows.length}
            </span>
          </h2>
          {d.rows.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">No workflows yet.</p>
          ) : (
            <div className="mt-2 overflow-x-auto card">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{d.domainName} workflows</caption>
                <thead className="bg-surface">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">Workflow</th>
                    <th scope="col" className="px-4 py-2 font-medium">Version</th>
                    <th scope="col" className="px-4 py-2 font-medium">Status</th>
                    <th scope="col" className="px-4 py-2 font-medium">TPT</th>
                    <th scope="col" className="px-4 py-2 font-medium">Modes</th>
                    {isAdmin && <th scope="col" className="px-4 py-2 font-medium">Project &amp; Assigned SME</th>}
                    <th scope="col" className="px-4 py-2 font-medium">{isAdmin ? 'SME studio URL & actions' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <DirectoryRow key={r.templateId} row={r} isAdmin={isAdmin} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      </div>

      {data.domains.length === 0 && <p className="mt-8 text-fg-muted">{isAdmin ? 'No domains yet. Domains and workflows come from the seed.' : 'No published templates yet.'}</p>}
    </div>
  );
}

function DirectoryRow({ row: r, isAdmin }: { row: DirectoryRowDto; isAdmin: boolean }) {
  const pill = STATUS_PILLS[r.status];
  const active = r.deployments.filter((d) => d.status === 'ACTIVE');
  const studio = active[0] ?? null;
  return (
    <tr data-search-id={r.templateId} className="border-t border-line align-top">
      <td className="px-4 py-2">
        <Link href={`/templates/${r.templateId}`} className="font-medium text-link hover:underline">
          {r.workflowName}
        </Link>
        {isAdmin && r.hasBlueprint && (
          <span className={`ml-2 text-xs ${r.validSections === BLUEPRINT_SECTIONS.length ? 'text-success' : 'text-fg-muted'}`}>
            {r.validSections}/{BLUEPRINT_SECTIONS.length} valid
          </span>
        )}
      </td>
      <td className="px-4 py-2">{versionLabel(r.version)}</td>
      <td className="px-4 py-2">
        <span className={`pill ${pill.tone}`}>{pill.label}</span>
      </td>
      <td className="px-4 py-2 whitespace-nowrap">{tptText(r.tptMinutes, r.tptLabel)}</td>
      <td className="px-4 py-2">{modesText(r.modes)}</td>
      {isAdmin && (
        <td className="px-4 py-2">
          {active.length === 0 ? (
            <span className="text-fg-muted">Unassigned</span>
          ) : (
            <ul className="space-y-1">
              {active.map((d) => (
                <li key={d.id}>
                  <span className="font-medium">{d.projectName}</span>
                  <span className="block text-xs text-fg-muted">{d.smeEmail ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </td>
      )}
      <td className="px-4 py-2">
        <div className="flex flex-col gap-1">
          {isAdmin && (studio?.studioUrl ? <code className="max-w-56 truncate text-xs" title={studio.studioUrl}>{studio.studioUrl}</code> : <span className="text-fg-muted">—</span>)}
          <div className="flex flex-wrap gap-3 text-xs">
            {isAdmin && studio?.studioUrl && (
              <a href={studio.studioUrl} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
                SME UI<span aria-hidden> ↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            {isAdmin ? (
              <Link href={`/templates/${r.templateId}`} className="text-link hover:underline">
                Edit Template<span aria-hidden> →</span>
              </Link>
            ) : (
              <Link href={`/projects/new?templateId=${r.templateId}`} className="text-link hover:underline">
                Create project
              </Link>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

const pillClass = (on: boolean) => `chip inline-block ${on ? '!border-focus bg-focus/20 font-semibold' : ''}`;
