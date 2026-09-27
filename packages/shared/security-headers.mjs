/**
 * HTTP security headers for the Next.js apps (hardening before external testing, 27 Sep 2026). Plain JavaScript so
 * next.config.ts can import it without a build step.
 *
 * @param {{ dev: boolean, scripts?: string[], frames?: string[], connect?: string[], styles?: string[] }} opts
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders({ dev, scripts = [], frames = [], connect = [], styles = [] }) {
  const csp = [
    "default-src 'self'",
    // Next.js inlines its bootstrap scripts; dev mode also needs eval for fast refresh.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} ${scripts.join(' ')}`.trim(),
    `style-src 'self' 'unsafe-inline' ${styles.join(' ')}`.trim(),
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws: http://localhost:*' : ''} ${connect.join(' ')}`.trim(),
    `frame-src ${frames.length ? frames.join(' ') : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
  ];
}
