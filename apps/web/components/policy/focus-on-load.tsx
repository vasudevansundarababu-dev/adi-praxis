'use client';

import { useEffect } from 'react';

/** The element a `?focus=` value opens (D-092): `[data-focus="<value>"]`, preferring a form control inside it. */
export function focusTarget(root: Pick<ParentNode, 'querySelector'>, focus: string): HTMLElement | null {
  // Focus values are fixed lower-case words; anything else opens nothing.
  if (!/^[a-z]+$/.test(focus)) return null;
  const el = root.querySelector<HTMLElement>(`[data-focus="${focus}"]`);
  if (!el) return null;
  if (el.matches('input, select, textarea, button, summary, a[href]')) return el;
  return el.querySelector<HTMLElement>('input, select, textarea, button, summary, a[href]') ?? el;
}

/**
 * Opens the rule page at the field for the review queue's next action (`?focus=condition`, `library`, `effective`,
 * `quote`, `question`, `definition`, `change`, `defines`): opens any closed section around it, scrolls to it and
 * focuses it. Does nothing without `?focus=` or when the page has no such field.
 */
export function FocusOnLoad() {
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (!focus) return;
    const t = focusTarget(document, focus);
    if (!t) return;
    for (let p: HTMLElement | null = t; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
    if (!t.matches('input, select, textarea, button, summary, a[href]')) t.tabIndex = -1;
    t.scrollIntoView({ block: 'center' });
    t.focus({ preventScroll: true });
  }, []);
  return null;
}
