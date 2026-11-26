import { documentReady, type LibraryDocument, type LibraryExportRow } from './library-logic';

/**
 * D-092 (owner, 26 Nov 2026): the Policy page opens with what to do next. Five steps (Documents → Facts → AI suggestions
 * → Review → Export), each done or not, with a count and one button; the first step not done is marked "Next" and gets
 * the primary button. Pure (`checklistSteps` is tested); the buttons go to the step's section on the page.
 */
export interface ChecklistInput {
  documents: LibraryDocument[];
  catalog: { version: number | null; catalogId: string | null; facts: number };
  /** Drafts, and how many have every library detail (no library_incomplete flag). */
  drafts: number;
  draftsWithLibrary: number;
  enrichment: { status: string } | null;
  counts: { rules: number; approved: number; excluded: number };
  ready: number;
  exports: LibraryExportRow[];
}
export interface ChecklistStep {
  key: 'documents' | 'facts' | 'ai' | 'review' | 'export';
  title: string;
  done: boolean;
  count: string;
  action: { label: string; href: string };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function checklistSteps(i: ChecklistInput): ChecklistStep[] {
  const docsReady = i.documents.filter(documentReady).length;
  const latest = i.exports[0] ?? null;
  return [
    {
      key: 'documents',
      title: 'Documents',
      done: i.documents.length > 0 && docsReady === i.documents.length,
      count: i.documents.length ? `${docsReady} of ${plural(i.documents.length, 'document')} ready` : 'No document yet',
      action: { label: i.documents.length ? 'Set document details' : 'Upload a document', href: '#documents' },
    },
    {
      key: 'facts',
      title: 'Facts',
      done: !!i.catalog.version,
      count: i.catalog.version ? `${plural(i.catalog.facts, 'fact')} loaded (${i.catalog.catalogId ?? 'catalog'}, version ${i.catalog.version})` : 'Fact catalog not loaded',
      action: { label: i.catalog.version ? 'See the facts' : 'Load the fact catalog', href: '#facts' },
    },
    {
      key: 'ai',
      title: 'AI suggestions',
      done: i.drafts === 0 || i.draftsWithLibrary === i.drafts || i.enrichment?.status === 'done',
      count: i.drafts ? `${i.draftsWithLibrary} of ${plural(i.drafts, 'draft')} have library details${i.enrichment?.status === 'no_worker' ? ' · no worker is running' : i.enrichment?.status === 'running' ? ' · running now' : ''}` : 'No drafts',
      action: { label: 'Suggest library details (AI)', href: '#ai-suggestions' },
    },
    {
      key: 'review',
      title: 'Review',
      done: i.counts.rules > 0 && i.counts.approved === i.counts.rules,
      count: `${i.counts.approved} of ${plural(i.counts.rules, 'rule')} approved${i.ready ? ` · ${i.ready} ready to confirm` : ''}`,
      action: { label: 'Open the review queue', href: '#review-queue' },
    },
    {
      key: 'export',
      title: 'Export',
      done: !!latest && latest.rules === i.counts.approved && i.counts.approved > 0,
      count: latest ? `Revision ${latest.revision} exported (${plural(latest.rules, 'rule')})${latest.rules !== i.counts.approved ? ' · approvals changed since' : ''}` : 'Not exported yet',
      action: { label: 'Export policy library', href: '#export' },
    },
  ];
}

export function SetupChecklist({ steps }: { steps: ChecklistStep[] }) {
  const next = steps.find((s) => !s.done)?.key ?? null;
  return (
    <section aria-labelledby="setup-h" className="card mt-6 p-4" data-setup-checklist>
      <h2 id="setup-h" className="text-lg font-semibold">
        Set up the policy library
      </h2>
      <p className="text-sm text-fg-muted">{next ? 'Work through the steps in order. The step marked Next is what to do now.' : 'Every step is done. Export again after you approve more rules.'}</p>
      <ol className="mt-3 grid gap-2 md:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s.key} className={`rounded border p-3 text-sm ${s.key === next ? 'border-primary border-2' : 'border-line'}`} data-step={s.key} data-done={s.done ? 'yes' : 'no'}>
            <p className="font-medium">
              <span aria-hidden="true">{s.done ? '✓' : `${i + 1}.`}</span> {s.title}
              <span className="sr-only">{s.done ? ' (done)' : ' (not done)'}</span>
              {s.key === next && <span className="ml-2 rounded bg-primary px-1.5 text-xs text-white">Next</span>}
            </p>
            <p className="mt-1 text-fg-muted">{s.count}</p>
            <a href={s.action.href} className={`btn mt-2 inline-block ${s.key === next ? 'btn-primary' : 'btn-secondary'}`}>
              {s.action.label}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
