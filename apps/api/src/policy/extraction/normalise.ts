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
  if (normaliseForMatch(c.quote).text.length < 8) return { quote: c.quote, locator: { ...base, kind: 'manual_reference' }, resolution: 'UNRESOLVED' };
  if (doc.format === 'pdf' && doc.pages.length) {
    const order = c.page ? [c.page - 1, ...doc.pages.map((_, i) => i).filter((i) => i !== c.page! - 1)] : doc.pages.map((_, i) => i);
    for (const i of order) {
      if (i < 0 || i >= doc.pages.length) continue;
      const span = findSpan(doc.pages[i]!, c.quote);
      if (span) return { quote: doc.pages[i]!.slice(span[0], span[1]), locator: { ...base, kind: 'page_region', page: i + 1 }, resolution: 'RESOLVED' };
    }
    return { quote: c.quote, locator: { ...base, kind: 'page_region', page: null }, resolution: 'QUOTE_MISMATCH' };
  }
  const span = findSpan(doc.text, c.quote);
  if (!span) return { quote: c.quote, locator: base, resolution: 'QUOTE_MISMATCH' };
  return {
    // The stored quote is the exact original document span, not the provider's tokenised copy (PR-R02).
    quote: doc.text.slice(span[0], span[1]),
    locator: { ...base, charStart: span[0], charEnd: span[1], lineStart: lineOf(doc.text, span[0]), lineEnd: lineOf(doc.text, Math.max(span[0], span[1] - 1)) },
    resolution: 'RESOLVED',
  };
}

const OPENERS = new Set(['(', '[']);
const CLOSERS = new Set(['.', ',', ';', ':', '!', '?', ')', ']']);
const foldChar = (ch: string) =>
  ch.replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"').replace(/[\u2010-\u2015\u2212]/g, '-');

/**
 * Normalises text for quote matching and keeps, for every output character, the [start, end) offsets of the
 * original characters it came from. Only harmless differences are removed: Unicode compatibility forms, case,
 * curly vs straight quotes, dash variants, runs of whitespace (including line breaks), and whitespace before
 * `. , ; : ! ? ) ]` or after `( [` (providers such as LlamaExtract return "only ." for "only."). Words are never
 * changed, added or dropped, so a quote whose words are not in the document still fails (PR-R02).
 */
export function normaliseForMatch(input: string): { text: string; starts: number[]; ends: number[] } {
  const chars: { ch: string; start: number; end: number }[] = [];
  let i = 0;
  for (const cp of input) {
    const end = i + cp.length;
    if (/\s/.test(cp)) {
      if (chars.length && chars[chars.length - 1]!.ch !== ' ') chars.push({ ch: ' ', start: i, end });
    } else {
      for (const ch of foldChar(cp.normalize('NFKC').toLowerCase())) {
        if (/\s/.test(ch)) {
          if (chars.length && chars[chars.length - 1]!.ch !== ' ') chars.push({ ch: ' ', start: i, end });
        } else chars.push({ ch, start: i, end });
      }
    }
    i = end;
  }
  const kept = chars.filter((c, k) => {
    if (c.ch !== ' ') return true;
    const prev = chars[k - 1];
    const next = chars[k + 1];
    return !!prev && !!next && !OPENERS.has(prev.ch) && !CLOSERS.has(next.ch);
  });
  return { text: kept.map((c) => c.ch).join(''), starts: kept.map((c) => c.start), ends: kept.map((c) => c.end) };
}

/**
 * Finds a quote in text, tolerant only of the differences normaliseForMatch removes; returns [start, end) offsets
 * into the ORIGINAL text, so the locator and stored quote are the exact source span.
 */
export function findSpan(text: string, quote: string): [number, number] | null {
  const exact = text.indexOf(quote);
  if (quote && exact >= 0) return [exact, exact + quote.length];
  const q = normaliseForMatch(quote).text;
  if (!q) return null;
  const t = normaliseForMatch(text);
  const at = t.text.indexOf(q);
  if (at < 0) return null;
  return [t.starts[at]!, t.ends[at + q.length - 1]!];
}
