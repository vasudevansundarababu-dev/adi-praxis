'use client';

import { createContext, useState } from 'react';
import type { SaveState } from './use-autosave';

/** The form's save state and Save, for panels drawn over the save bar (the criterion panel). */
export const FormSaveContext = createContext<{ state: SaveState; flush: () => Promise<boolean> } | null>(null);

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The bar's status text from the autosave state and the last manual save (D12). */
export function saveStatus(state: SaveState, manualAt: string | null, failed: boolean): { text: string; error: boolean } {
  if (state.kind === 'saving') return { text: 'Saving…', error: false };
  if (failed || state.kind === 'error') return { text: 'Couldn’t save, try again', error: true };
  // The header already shows the conflict's own message; the bar says what to do, without repeating it.
  if (state.kind === 'conflict') return { text: 'Not saved: reload the page to continue', error: true };
  const at = [state.kind === 'saved' ? state.at : undefined, manualAt].filter((x): x is string => !!x).sort().pop();
  return at ? { text: `Saved at ${hhmm(at)}`, error: false } : { text: 'All changes save automatically', error: false };
}

/**
 * D12 (owner, 15 Nov 2026): a Save button that is always on screen, in a sticky action bar at the bottom of the
 * authoring form. It saves the draft now (the autosave's flush). It never submits and never runs Submit's checks;
 * autosave keeps working as before. `children` is the bar's other action (e.g. going to Check and submit).
 */
export function SaveBar({ state, flush, readOnly, children }: { state: SaveState; flush: () => Promise<boolean>; readOnly: boolean; children?: React.ReactNode }) {
  const [manualAt, setManualAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  if (readOnly) return null;
  const status = saveStatus(pending ? { kind: 'saving' } : state, manualAt, failed);
  async function save() {
    setPending(true);
    const ok = await flush();
    setPending(false);
    setFailed(!ok);
    if (ok) setManualAt(new Date().toISOString());
  }
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-4 border-t border-line bg-surface/95 px-1 py-2 backdrop-blur print:hidden" data-save-bar>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className="btn btn-secondary disabled:opacity-60" data-save-now>
          {status.error ? 'Try again' : 'Save'}
        </button>
        <span role="status" aria-live="polite" className={`text-sm ${status.error ? 'text-error' : 'text-fg-muted'}`}>
          {status.text}
        </span>
        {children && <span className="ml-auto flex flex-wrap gap-2">{children}</span>}
      </div>
    </div>
  );
}
