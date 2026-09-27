import { sha256 } from '../lib/crypto';
import { ibanValid, luhnValid } from '../candidate/sensitive';

/**
 * TASK-KYC section 2: flags likely real data in an authored task before submit. Identifiers that pass real checksums,
 * national ID formats, and email addresses or phone numbers outside reserved/fictitious ranges are flagged. Values
 * from the workbench's synthetic generator (SYN- identifiers, example.test addresses, Ofcom drama numbers) pass.
 * Copy detection against known sources needs an external corpus and is not done in v1.
 */
export interface DataFlag {
  id: string;
  kind: string;
  /** JSON path of the field, e.g. customerFile.parties[0].email */
  path: string;
  excerpt: string;
}

const RESERVED_EMAIL = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/i;
const FICTIONAL_PHONE = [/^(?:\+44\s?|0)7700\s?900\d{3}$/, /^(?:\+44\s?|0)1632\s?960\d{3}$/, /^(?:\+44\s?|0)20\s?7946\s?0\d{3}$/, /^(?:\+1[\s-]?)?\(?\d{3}\)?[\s-]?555[\s-]?01\d{2}$/];

const RULES: { kind: string; re: RegExp; real: (m: string) => boolean }[] = [
  { kind: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/gi, real: ibanValid },
  { kind: 'CARD_NUMBER', re: /\b\d(?:[ -]?\d){12,18}\b/g, real: luhnValid },
  { kind: 'UK_NI_NUMBER', re: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g, real: (m) => !/^QQ/i.test(m) },
  { kind: 'US_SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g, real: (m) => !/^(000|666|9\d\d)-|^987-65-432\d$/.test(m) },
  { kind: 'IN_PAN', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, real: () => true },
  { kind: 'IN_AADHAAR', re: /(?<![\d][ -]?)\b\d{4}\s\d{4}\s\d{4}\b(?![ -]?\d)/g, real: () => true },
  { kind: 'EMAIL', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, real: (m) => !RESERVED_EMAIL.test(m) },
  { kind: 'PHONE', re: /(?<![\w-])(?:\+\d{1,3}[\s-]?\d{2,4}|\(\d{2,5}\)|0\d{2,4})[\s-]?\d{3,4}[\s-]?\d{3,4}(?![-\w])/g, real: (m) => !FICTIONAL_PHONE.some((r) => r.test(m.trim())) },
  // Company and passport numbers only when labelled as such, and not from the synthetic generator.
  // The identifier must contain a digit, so ordinary words ("passport expired") are not identifiers.
  { kind: 'COMPANY_NUMBER', re: /\b(?:company|registration|registry)\s*(?:number|no\.?|#)\s*[:#]?\s*(?=[A-Z-]*\d)[A-Z0-9-]{6,12}\b/gi, real: (m) => !/SYN-?[A-Z0-9]+\s*$/i.test(m) },
  { kind: 'PASSPORT_NUMBER', re: /\bpassport\s*(?:number|no\.?|#)?\s*[:#]?\s*(?=[A-Z-]*\d)[A-Z0-9-]{6,12}\b/gi, real: (m) => !/SYN-?[A-Z0-9]+\s*$/i.test(m) },
];

function walk(v: unknown, path: string, out: [string, string][]) {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, out);
}

export function scanForRealData(output: unknown): DataFlag[] {
  const strings: [string, string][] = [];
  walk(output, '', strings);
  const flags = new Map<string, DataFlag>();
  for (const [path, text] of strings) {
    for (const rule of RULES) {
      for (const m of text.matchAll(rule.re)) {
        if (!rule.real(m[0])) continue;
        const id = sha256(`${rule.kind}|${path}|${m[0]}`).slice(0, 16);
        flags.set(id, { id, kind: rule.kind, path, excerpt: m[0].length > 40 ? `${m[0].slice(0, 37)}…` : m[0] });
      }
    }
  }
  return [...flags.values()];
}
