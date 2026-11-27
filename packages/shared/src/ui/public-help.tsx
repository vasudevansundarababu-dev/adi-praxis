'use client';

import { useEffect, useState } from 'react';

/** The static help for one public page (GET /api/v1/help/public). */
export interface PublicPageHelpDto {
  title: string;
  intro: string;
  terms: { term: string; meaning: string; example: string }[];
  stuck: string;
}

/**
 * D-109 / D-110 (owner, 27 Nov 2026): the Help button on pages anyone can open without signing in. It reads the
 * page's fixed help text and shows it in a panel. There is no question box and no Support Bot: nothing is sent except
 * which page this is. When the server has no public help for the page, nothing is shown.
 */
export function PublicHelp({ app, path }: { app: 'sme' | 'console'; path: string }) {
  const [help, setHelp] = useState<PublicPageHelpDto | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setHelp(null);
    fetch(`/api/v1/help/public?app=${app}&path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? (r.json() as Promise<PublicPageHelpDto>) : null))
      .then((h) => live && setHelp(h))
      .catch(() => live && setHelp(null));
    return () => {
      live = false;
    };
  }, [app, path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!help) return null;
  return <PublicHelpPanel help={help} open={open} onToggle={() => setOpen((o) => !o)} />;
}

/** The panel itself (no fetching), so it can be rendered in tests. */
export function PublicHelpPanel({ help, open, onToggle }: { help: PublicPageHelpDto; open: boolean; onToggle: () => void }) {
  return (
    <div data-public-help className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2 text-fg print:hidden" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {open && (
        <section role="dialog" aria-label={`Help: ${help.title}`} className="card flex max-h-[min(36rem,80vh)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden bg-surface shadow-xl">
          <header className="flex items-start justify-between gap-3 bg-brand-navy px-4 py-3 text-white">
            <div>
              <h2 className="text-sm font-semibold">Help: {help.title}</h2>
              <p className="text-xs text-white/75">{help.intro}</p>
            </div>
            <button type="button" onClick={onToggle} className="rounded-md px-2 py-1 text-sm text-white/85 hover:bg-white/10" aria-label="Close help">
              ✕
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            <dl className="space-y-3">
              {help.terms.map((x) => (
                <div key={x.term} data-help-term={x.term}>
                  <dt className="font-semibold">{x.term}</dt>
                  <dd className="mt-0.5">{x.meaning}</dd>
                  <dd className="mt-0.5 text-fg-muted">
                    <span className="font-medium">Example:</span> {x.example}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="rounded-md border border-line p-3">
              <p className="font-semibold">If something goes wrong</p>
              <p className="mt-0.5">{help.stuck}</p>
            </div>
          </div>
        </section>
      )}
      <button type="button" onClick={onToggle} aria-expanded={open} className="btn btn-primary rounded-full px-4 shadow-lg">
        {open ? 'Close help' : 'Help'}
      </button>
    </div>
  );
}
