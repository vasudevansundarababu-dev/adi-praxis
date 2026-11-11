'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error' | 'conflict'; at?: string; message?: string };

/** Where a draft is saved. Defaults to the task route; the SME studio saves to its own draft route. */
export interface AutosaveTarget<T> {
  url: string;
  body: (value: T, expectedRevision: number, activeSecondsDelta: number) => unknown;
}

/**
 * Autosave for a task draft: saves 1.5 s after the last change and records time actively spent (seconds while the
 * page is visible and the author did something in the last minute). Stale revisions surface as a conflict.
 */
export function useAutosave<T extends Record<string, unknown>>(taskId: string, initial: T, initialRevision: number, readOnly: boolean, target?: AutosaveTarget<T>) {
  const router = useRouter();
  const [value, setValue] = useState<T>(initial);
  const [revision, setRevision] = useState(initialRevision);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const dirty = useRef(false);
  const active = useRef(0);
  const lastInput = useRef(Date.now());
  const rev = useRef(initialRevision);
  const latest = useRef(value);
  const readonlyNow = useRef(readOnly);
  readonlyNow.current = readOnly;
  const inFlight = useRef<Promise<boolean> | null>(null);
  const navigating = useRef(false);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (readOnly) return;
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInput.current < 60_000) active.current += 1;
    }, 1000);
    const mark = () => {
      lastInput.current = Date.now();
    };
    window.addEventListener('keydown', mark);
    window.addEventListener('pointerdown', mark);
    return () => {
      clearInterval(tick);
      window.removeEventListener('keydown', mark);
      window.removeEventListener('pointerdown', mark);
    };
  }, [readOnly]);

  // PUT is not in the shared browser helper, so this uses fetch directly (same Idempotency-Key rule).
  const put = useCallback(async () => {
    // A flush drains edits made during a request, using each acknowledged revision once.
    while (true) {
      if (inFlight.current) {
        if (!(await inFlight.current)) return false;
        continue;
      }
      if (!dirty.current) return true;
      if (readonlyNow.current) {
        setState({ kind: 'error', message: 'Your edits are unsaved. Return to an editable view to save before leaving.' });
        return false;
      }
      dirty.current = false;
      setState({ kind: 'saving' });
      const delta = Math.min(600, active.current);
      const expectedRevision = rev.current;
      const t = targetRef.current;
      const payload = JSON.stringify(t ? t.body(latest.current, expectedRevision, delta) : { output: latest.current, activeSecondsDelta: delta, expectedRevision });
      const request = (async () => {
        try {
          const res = await fetch(t ? t.url : `/api/v1/me/tasks/${taskId}`, {
            method: 'PUT', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: payload,
          });
          const body = await res.json().catch(() => null);
          if (res.ok && body?.revision === expectedRevision + 1 && typeof body.savedAt === 'string') {
            active.current -= delta;
            rev.current = body.revision;
            setRevision(body.revision);
            window.dispatchEvent(new CustomEvent('praxis:task-saved',{detail:{taskId,output:JSON.parse(payload).output,revision:body.revision}}));
            if (!dirty.current) setState({ kind: 'saved', at: body.savedAt });
            return true;
          }
          dirty.current = true;
          setState({ kind: res.ok || body?.error === 'STALE_REVISION' ? 'conflict' : 'error', message: res.ok ? 'Save confirmation could not be verified. Reload before continuing.' : body?.message ?? 'Could not save' });
          return false;
        } catch {
          dirty.current = true;
          setState({ kind: 'error', message: 'Offline: your changes are kept here and will save when you reconnect.' });
          return false;
        }
      })();
      inFlight.current = request;
      let saved: boolean;
      try { saved = await request; }
      finally { if (inFlight.current === request) inFlight.current = null; }
      if (!saved) return false;
    }
  }, [taskId]);

  useEffect(() => {
    if (readOnly || !dirty.current) return;
    const t = setTimeout(() => void put(), 1500);
    return () => clearTimeout(t);
  }, [value, put, readOnly]);

  // Retry a failed (e.g. offline) save every 10 s until it lands.
  useEffect(() => {
    if (state.kind !== 'error') return;
    const t = setTimeout(() => void put(), 10_000);
    return () => clearTimeout(t);
  }, [state, put]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // The workbench's in-app back link does not trigger beforeunload.
  useEffect(() => {
    let active = true;
    const leave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || (!dirty.current && !inFlight.current)) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-save-before-leaving]') : null;
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      if (navigating.current) return;
      navigating.current = true;
      void put().then((saved) => {
        navigating.current = false;
        if (saved && active) router.push(destination.pathname + destination.search + destination.hash);
      });
    };
    document.addEventListener('click', leave, true);
    return () => { active = false; document.removeEventListener('click', leave, true); };
  }, [put, router]);

  useEffect(()=>{const listener=(e:Event)=>{(e as CustomEvent<{saves:Promise<boolean>[]}>).detail.saves.push(put());};window.addEventListener('praxis:flush',listener);return()=>window.removeEventListener('praxis:flush',listener);},[put]);

  const update = useCallback((next: T | ((prev: T) => T)) => {
    if (readonlyNow.current) return;
    dirty.current = true;
    const updated = typeof next === 'function' ? next(latest.current) : next;
    latest.current = updated;
    setValue(updated);
    setState((s) => s.kind === 'saved' ? { kind: 'idle' } : s);
  }, []);

  // Panels outside the editor (the workflow graph) change top-level output keys through this same autosave, so the
  // task keeps one writer, one revision sequence and one save barrier.
  useEffect(() => {
    const listener = (e: Event) => {
      const d = (e as CustomEvent<{ taskId: string; patch: Record<string, unknown> }>).detail;
      if (d?.taskId === taskId && !targetRef.current) update((prev) => ({ ...prev, ...d.patch }));
    };
    window.addEventListener('praxis:patch-output', listener);
    return () => window.removeEventListener('praxis:patch-output', listener);
  }, [taskId, update]);

  return { value, update, revision, currentRevision: useCallback(() => rev.current, []), state, flush: put };
}
