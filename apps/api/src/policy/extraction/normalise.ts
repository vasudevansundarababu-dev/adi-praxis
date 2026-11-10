import { CandidateRule, type CandidateCitation, type Locator } from '@praxis/shared';
import { lineOf } from '../document-reader';

/**
 * Maps one provider "rule" object (shaped by EXTRACTION_JSON_SCHEMA) to the canonical candidate. Unknown or
 * malformed fields become null/unknown; the rule is dropped only when it has neither a requirement nor a title.
 */
export function toCandidate(raw: unknown, citations: CandidateCitation[]): CandidateRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = 4000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 200)).filter((x): x is string => !!x).slice(0, 50) : []);
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const requirement = str(r.requirement);
  const title = str(r.title, 500) ?? requirement?.slice(0, 120) ?? null;
  if (!requirement && !title) return null;
  const exceptions = arr(r.exceptions);
  const kind = r.exceptionsKind === 'none' || r.exceptionsKind === 'listed' ? (r.exceptionsKind as 'none' | 'listed') : exceptions.length ? 'listed' : 'unknown';
  const parsed = CandidateRule.safeParse({
    title,
    requirement: requirement ?? '',
    requirementType: ['obligation', 'prohibition', 'permission', 'definition'].includes(r.requirementType as string) ? r.requirementType : 'unknown',
    applicability: { actors: arr(r.actors), actions: arr(r.actions), channels: arr(r.channels), locales: arr(r.locales), jurisdictions: arr(r.jurisdictions), conditionText: str(r.conditionText) },
    prerequisites: arr(r.prerequisites),
    exceptions: { kind, items: kind === 'listed' ? exceptions.map((statement) => ({ statement, conditions: null })) : [] },
    effective: { from: date(r.effectiveFrom), to: date(r.effectiveTo), conditionText: null },
    evidenceNeeds: arr(r.evidenceNeeds),
    uncertainty: arr(r.uncertainty),
    citations,
  });
  return parsed.success ? parsed.data : null;
}

/** A candidate is Needs definition when a reviewer must supply a core part before it can be reviewed (S1 R05). */
export function needsDefinition(c: CandidateRule): boolean {
  const a = c.applicability;
  const hasScope = a.universal || a.actors.length + a.actions.length + a.channels.length + a.entities.length > 0 || !!a.conditionText;
  return !c.requirement || c.requirementType === 'unknown' || !hasScope || c.citations.length === 0;
}

const squash = (s: string) => s.normalize('NFKC').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

export interface ResolvedCitation {
  quote: string;
  locator: Locator;
  resolution: 'RESOLVED' | 'QUOTE_MISMATCH' | 'UNRESOLVED';
}

/**
 * Checks a proposed quote against Praxis's own reading of the exact document version (S2 §9). A page or line is only
 * recorded when the quote is found there; provider page numbers are never trusted on their own.
 */
export function resolveCitation(c: CandidateCitation, doc: { text: string; pages: string[]; format: string }): ResolvedCitation {
  const base: Locator = { kind: 'text_span', page: null, renditionPage: null, lineStart: null, lineEnd: null, charStart: null, charEnd: null, section: null, chunkId: c.chunkId ?? null, boxes: null };
  const q = squash(c.quote);
  if (q.length < 8) return { quote: c.quote, locator: { ...base, kind: 'manual_reference' }, resolution: 'UNRESOLVED' };
  if (doc.format === 'pdf' && doc.pages.length) {
    const hint = Number.isInteger(c.page) && c.page! >= 1 && c.page! <= doc.pages.length ? c.page! - 1 : null;
    const order = hint === null ? doc.pages.map((_, i) => i) : [hint, ...doc.pages.map((_, i) => i).filter((i) => i !== hint)];
    for (const i of order) {
      if (squash(doc.pages[i]!).includes(q)) return { quote: c.quote, locator: { ...base, kind: 'page_region', page: i + 1 }, resolution: 'RESOLVED' };
    }
    return { quote: c.quote, locator: { ...base, kind: 'page_region', page: null }, resolution: 'QUOTE_MISMATCH' };
  }
  const span = findSpan(doc.text, c.quote);
  if (!span) return { quote: c.quote, locator: base, resolution: 'QUOTE_MISMATCH' };
  return {
    quote: c.quote,
    locator: { ...base, charStart: span[0], charEnd: span[1], lineStart: lineOf(doc.text, span[0]), lineEnd: lineOf(doc.text, Math.max(span[0], span[1] - 1)) },
    resolution: 'RESOLVED',
  };
}

/** Finds a quote in text, tolerant of whitespace and typographic quote differences; returns [start, end) offsets. */
export function findSpan(text: string, quote: string): [number, number] | null {
  const exact = text.indexOf(quote);
  if (exact >= 0) return [exact, exact + quote.length];
  const words = quote.normalize('NFKC').trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['\u2018\u2019]/g, "['\u2018\u2019]").replace(/["\u201C\u201D]/g, '["\u201C\u201D]').replace(/[-\u2013\u2014]/g, '[-\u2013\u2014]'));
  if (!words.length || words.length > 400) return null;
  const { normalised, start, end } = nfkcWithOrigin(text);
  const m = new RegExp(words.join('\\s+'), 'i').exec(normalised);
  return m && m[0].length ? [start[m.index]!, end[m.index + m[0].length - 1]!] : null;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * NFKC per grapheme, recording for each normalised UTF-16 unit the [start, end) of the original grapheme it came from,
 * so offsets found in the normalised text point at the original text even where "ﬁ" became "fi".
 */
function nfkcWithOrigin(text: string): { normalised: string; start: number[]; end: number[] } {
  let normalised = '';
  const start: number[] = [];
  const end: number[] = [];
  for (const { segment, index } of graphemes.segment(text)) {
    const n = segment.normalize('NFKC');
    normalised += n;
    for (let k = 0; k < n.length; k++) {
      start.push(index);
      end.push(index + segment.length);
    }
  }
  return { normalised, start, end };
}
