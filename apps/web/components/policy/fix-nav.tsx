'use client';

import { useState, type ReactNode } from 'react';
import { EDIT_FORM_FIELDS, FIX_ANCHOR, fixesFor, stillMissing, type FixField, type FixItem } from './fix-logic';

/** The amber outline on a field that still has something to fix. */
export const FIX_OUTLINE = 'outline outline-2 outline-offset-2 outline-warning';
const FLASH = ['ring-4', 'ring-warning', 'ring-offset-2'];

/** Whether a field shows its outline and hint (`value` = what is typed so far, for the fields that clear as you type). */
export function fixOpen(fixes: readonly FixItem[], field: FixField, value?: string): boolean {
  const mine = fixesFor(fixes, field);
  if (!mine.length) return false;
  if (value === undefined || mine.some((f) => f.question)) return true;
  return stillMissing(field, value);
}

/**
 * Goes to a field: opens the closed section it is in (the edit form loads when opened, so this waits for it), scrolls
 * it to the middle of the screen, focuses it and flashes an amber ring around it for two seconds.
 */
export async function jumpToField(field: FixField): Promise<boolean> {
  const id = FIX_ANCHOR[field];
  let el = document.getElementById(id);
  if (!el && EDIT_FORM_FIELDS.includes(field)) {
    const form = document.querySelector<HTMLDetailsElement>('details[data-edit-form]');
    if (form) form.open = true;
    for (let i = 0; i < 50 && !el; i++) {
      await new Promise((r) => setTimeout(r, 100));
      el = document.getElementById(id);
    }
  }
  if (!el) el = document.getElementById(FIX_ANCHOR.status);
  if (!el) return false;
  for (let p: HTMLElement | null = el; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
  const target = el.matches('input, select, textarea, button') ? el : (el.querySelector<HTMLElement>('input, select, textarea, button') ?? el);
  if (!target.matches('input, select, textarea, button')) target.tabIndex = -1;
  el.scrollIntoView({ block: 'center' });
  target.focus({ preventScroll: true });
  el.classList.add(...FLASH);
  setTimeout(() => el!.classList.remove(...FLASH), 2000);
  return true;
}

/** The hint(s) under a field: what is missing, how to fix it, an example; open questions about the field. */
export function FixHint({ fixes, field, value }: { fixes: readonly FixItem[]; field: FixField; value?: string }) {
  if (!fixOpen(fixes, field, value)) return null;
  const mine = fixesFor(fixes, field).filter((f) => f.question || value === undefined || stillMissing(field, value));
  return (
    <div id={`${FIX_ANCHOR[field]}-hint`} className="mt-1 space-y-1" data-fix-hint={field} role="note">
      {mine.map((f) => (
        <p key={f.id} className="rounded border-l-4 border-warning bg-warning/10 px-2 py-1 text-xs text-fg">
          {f.question ? (
            <>
              <strong>Open question:</strong> {f.question} <span className="text-fg-muted">{f.hint}</span>
            </>
          ) : (
            f.hint
          )}
        </p>
      ))}
    </div>
  );
}

/** "To fix" at the top of the rule page: every open problem as a link to its field. */
export function FixList({ fixes, under }: { fixes: readonly FixItem[]; under?: (f: FixItem) => ReactNode }) {
  if (!fixes.length) return null;
  return (
    <div className="mt-2 rounded border border-warning p-3" data-fix-list>
      <h3 className="font-semibold">To fix ({fixes.length})</h3>
      <p className="text-xs text-fg-muted">Click a problem to go straight to its field. The field has an amber outline and a hint under it.</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        {fixes.map((f) => (
          <li key={f.id}>
            <a
              href={`#${FIX_ANCHOR[f.field]}`}
              data-fix-link={f.field}
              data-fix-flag={f.flag}
              className="text-link hover:underline"
              onClick={(e) => {
                e.preventDefault();
                void jumpToField(f.field);
              }}
            >
              {f.label}
            </a>
            {under?.(f)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The bar fixed to the bottom of the rule page: "Next problem" goes to the next item in the "To fix" list, in page
 * order, round again after the last. With nothing left it reads "Ready to approve", with the link to approve it in the
 * review queue (the approval stays there, D-091/D-094).
 */
export function NextProblemBar({ fixes, queueHref }: { fixes: readonly FixItem[]; queueHref: string }) {
  const [at, setAt] = useState(-1);
  const fields = fixes.map((f) => f.field).filter((f, i, all) => all.indexOf(f) === i);
  if (!fields.length)
    return (
      <div className="sticky bottom-0 z-30 -mx-1 mt-4 flex flex-wrap items-center gap-3 rounded-t border border-success bg-surface px-4 py-2 shadow-lg" data-next-problem="ready">
        <span className="font-semibold text-success">Ready to approve</span>
        <a href={queueHref} className="btn btn-primary">
          Approve in the review queue
        </a>
        <span className="text-xs text-fg-muted">Nothing is left to fix on this rule. Your confirm in the review queue is the approval.</span>
      </div>
    );
  const next = (at + 1) % fields.length;
  const label = fixes.find((f) => f.field === fields[next])!.label;
  return (
    <div className="sticky bottom-0 z-30 -mx-1 mt-4 flex flex-wrap items-center gap-3 rounded-t border border-warning bg-surface px-4 py-2 shadow-lg" data-next-problem="open">
      <span className="font-semibold">
        {fixes.length} to fix
      </span>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          setAt(next);
          void jumpToField(fields[next]!);
        }}
      >
        Next problem
      </button>
      <span className="text-xs text-fg-muted">
        Next: {label} ({next + 1} of {fields.length})
      </span>
    </div>
  );
}
