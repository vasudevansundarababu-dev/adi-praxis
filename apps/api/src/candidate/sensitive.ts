/**
 * Detects likely real customer or confidential data in candidate text (FLOW2 4.1, CF-13). Runs before anything is
 * stored or sent to the model. Checksum-backed patterns (IBAN mod-97, card Luhn) keep false positives down.
 * Flagged text is stored redacted only; the original is discarded (decided 26 Sep 2026).
 */
export interface SensitiveResult {
  flagged: boolean;
  kinds: string[];
  redacted: string;
}

export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const d = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const n of d) rem = (rem * 10 + Number(n)) % 97;
  }
  return rem === 1;
}

export function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const RULES: { kind: string; re: RegExp; check?: (m: string) => boolean }[] = [
  { kind: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/gi, check: ibanValid },
  { kind: 'CARD_NUMBER', re: /\b\d(?:[ -]?\d){12,18}\b/g, check: luhnValid },
  { kind: 'ACCOUNT_NUMBER', re: /\b(?:account|acct|a\/c)(?:\s+(?:number|no\.?|#))?\s*[:#]?\s*\d{6,18}\b/gi },
  { kind: 'SORT_CODE_ACCOUNT', re: /\b\d{2}-\d{2}-\d{2}\s*\/?\s*\d{8}\b/g },
  { kind: 'UK_NI_NUMBER', re: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g },
  { kind: 'US_SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: 'IN_PAN', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  // Exactly three groups of four digits, not part of a longer number (e.g. a 16-digit card).
  { kind: 'IN_AADHAAR', re: /(?<![\d][ -]?)\b\d{4}\s\d{4}\s\d{4}\b(?![ -]?\d)/g },
  { kind: 'PASSPORT_NUMBER', re: /\bpassport\s*(?:number|no\.?|#)?\s*[:#]?\s*[A-Z0-9]{6,9}\b/gi },
  { kind: 'EMAIL', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  // International (+CC), national trunk (0…) or bracketed area code; never a slice of a longer number.
  // Indian mobiles: optional +91/0091, ten digits starting 6-9, grouped any way (e.g. +91 98765 43210).
  { kind: 'PHONE', re: /(?<!\d)(?:(?:\+|00)91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g },
  { kind: 'PHONE', re: /(?<!\d)(?:\+\d{1,3}[\s-]?\d{2,4}|\(\d{2,5}\)|0\d{2,4})[\s-]?\d{3,4}[\s-]?\d{3,4}(?!\d)/g },
];

export function detectSensitive(text: string, opts: { allowEmails?: string[] } = {}): SensitiveResult {
  const kinds = new Set<string>();
  let redacted = text;
  for (const rule of RULES) {
    redacted = redacted.replace(rule.re, (m) => {
      if (rule.check && !rule.check(m)) return m;
      if (rule.kind === 'EMAIL' && opts.allowEmails?.some((e) => e.toLowerCase() === m.toLowerCase())) return m;
      kinds.add(rule.kind);
      return `[removed: ${rule.kind.toLowerCase().replace(/_/g, ' ')}]`;
    });
  }
  return { flagged: kinds.size > 0, kinds: [...kinds], redacted };
}

/** The matched values themselves (kind and text), for callers that must keep them out of generated content. */
export function findSensitive(text: string): { kind: string; value: string }[] {
  const out: { kind: string; value: string }[] = [];
  for (const rule of RULES) for (const m of text.matchAll(rule.re)) if (!rule.check || rule.check(m[0])) out.push({ kind: rule.kind, value: m[0] });
  return out;
}
