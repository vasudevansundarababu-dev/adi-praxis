'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error' | 'conflict'; at?: string; message?: string };

/**
 * Autosave for a task draft: saves 1.5 s after the last change and records time actively spent (seconds while the
 * page is visible and the author did something in the last minute). Stale revisions surface as a conflict.
 */
export function useAutosave<T extends Record<string, unknown>>(taskId: string, initial: T, initialRevision: number, readOnly: boolean) {
  const [value, setValue] = useState<T>(initial);
  const [revision, setRevision] = useState(initialRevision);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const dirty = useRef(false);
  const active = useRef(0);
  const lastInput = useRef(Date.now());
  const rev = useRef(initialRevision);
  const latest = useRef(value);
  latest.current = value;

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
    if (readOnly || !dirty.current) return true;
    dirty.current = false;
    setState({ kind: 'saving' });
    const delta = Math.min(600, active.current);
    try {
      const res = await fetch(`/api/v1/me/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ output: latest.current, activeSecondsDelta: delta, expectedRevision: rev.current }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        active.current -= delta;
        rev.current = body.revision;
        setRevision(body.revision);
        setState({ kind: 'saved', at: body.savedAt });
        return true;
      }
      dirty.current = true;
      setState({ kind: body?.error === 'STALE_REVISION' ? 'conflict' : 'error', message: body?.message ?? 'Could not save' });
      return false;
    } catch {
      dirty.current = true;
      setState({ kind: 'error', message: 'Offline: your changes are kept here and will save when you reconnect.' });
      return false;
    }
  }, [readOnly, taskId]);

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
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const update = useCallback((next: T | ((prev: T) => T)) => {
    if (readOnly) return;
    dirty.current = true;
    setValue(next);
  }, [readOnly]);

  return { value, update, revision, currentRevision: useCallback(() => rev.current, []), state, flush: put };
}
