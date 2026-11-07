/** Redacts secrets and personal data from logs before they are stored or shown (S3-08, NFR-04). */
const RULES: [RegExp, string][] = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/\bsk-(ant|proj)?-?[A-Za-z0-9_-]{8,}/g, '[redacted-key]'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, '[redacted-key]'],
  [/\bya29\.[0-9A-Za-z._-]+/g, '[redacted-token]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-private-key]'],
  [/\b(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]'],
  [/postgres(ql)?:\/\/[^\s"']+/gi, 'postgresql://[redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]'],
];

export function redact(text: string): string {
  return RULES.reduce((s, [re, to]) => s.replace(re, to), text);
}

export const tail = (text: string, max = 4000) => (text.length > max ? text.slice(-max) : text);
