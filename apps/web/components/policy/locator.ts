export function locatorText(l: { page?: number | null; lineStart?: number | null; lineEnd?: number | null; section?: string | null }) {
  if (l.page) return `page ${l.page}`;
  if (l.lineStart) return l.lineEnd && l.lineEnd !== l.lineStart ? `lines ${l.lineStart}–${l.lineEnd}` : `line ${l.lineStart}`;
  if (l.section) return `section ${l.section}`;
  return 'no locator';
}
