/**
 * KYC Judgment v1 C1 `source_text` (owner, 25 Nov 2026, spec §16: `policy.read` serves the source text): the verbatim
 * passage a rule was extracted from, with enough context to stand alone. The whole sentence around the quote, or, when
 * the quote is a list item or a fragment, its whole paragraph with the lead-in line that introduces the list. Never
 * reworded: a slice of the document text, trimmed at its ends only.
 */
const MAX = 2000;
const SHORT = 40;
const LIST_ITEM = /^\s*(?:\(?[0-9a-z]{1,3}\s?[.)]|[-*•])\s/i;

function locate(text: string, quote: string, locator: unknown): [number, number] | null {
  const l = (locator ?? {}) as { charStart?: number | null; charEnd?: number | null };
  if (typeof l.charStart === 'number' && typeof l.charEnd === 'number' && l.charStart >= 0 && l.charEnd <= text.length && l.charEnd > l.charStart) return [l.charStart, l.charEnd];
  const q = quote.trim();
  if (!q) return null;
  const i = text.indexOf(q);
  if (i >= 0) return [i, i + q.length];
  // Spacing may differ (extraction keeps "3 . an address ;"): match with any run of whitespace.
  const re = new RegExp(q.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
  const m = re.exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

/** The paragraph (between blank lines) that holds [start, end). */
function paragraph(text: string, start: number, end: number): [number, number] {
  const before = text.lastIndexOf('\n\n', start);
  const after = text.indexOf('\n\n', end);
  return [before < 0 ? 0 : before + 2, after < 0 ? text.length : after];
}

export function sourcePassage(text: string, quote: string, locator: unknown = null): string {
  const at = locate(text, quote, locator);
  if (!at) return quote.trim();
  const [ps, pe] = paragraph(text, at[0], at[1]);
  // The sentence: from the last sentence end before the quote to the first after it, inside the paragraph and line block.
  const ends = /[.!?](?=\s)|\n/g;
  let s = ps;
  for (let m; (m = ends.exec(text.slice(ps, at[0]))); ) s = ps + m.index + 1;
  ends.lastIndex = 0;
  const tail = text.slice(at[1], pe);
  const m = /[.!?](?=\s|$)|\n/.exec(tail);
  const e = m ? at[1] + m.index + (m[0] === '\n' ? 0 : 1) : pe;
  let out = text.slice(s, e).trim();
  // A list item or a fragment doesn't stand alone: take the whole paragraph, and the lead-in line that ends with ":".
  if (out.length < SHORT || LIST_ITEM.test(out)) {
    let start = ps;
    const lines = text.slice(ps, at[0]).split('\n');
    const leadIdx = [...lines.keys()].reverse().find((i) => /:\s*$/.test(lines[i]!));
    if (leadIdx === undefined && ps > 0) {
      // The list may be its own paragraph: the previous paragraph's last line introduces it.
      const prev = paragraph(text, Math.max(0, ps - 2), Math.max(0, ps - 2));
      const prevText = text.slice(prev[0], prev[1]);
      if (/:\s*$/.test(prevText)) start = prev[0];
    }
    out = text.slice(start, pe).trim();
  }
  return out.length > MAX ? out.slice(0, MAX).trimEnd() : out;
}
