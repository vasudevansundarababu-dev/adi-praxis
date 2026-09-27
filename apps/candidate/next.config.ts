import type { NextConfig } from 'next';
import path from 'node:path';
import { securityHeaders } from '@praxis/shared/security-headers';

const dev = process.env.NODE_ENV !== 'production';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  // Lets a verification build run beside `next dev` without clobbering its .next folder.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@praxis/shared'],
  // Do not advertise the framework; send security headers on every page (hardening, 27 Sep 2026).
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders({ dev, scripts: ['https://accounts.google.com/gsi/client'], frames: ['https://accounts.google.com'], connect: ['https://accounts.google.com'], styles: ['https://accounts.google.com/gsi/style'] }) }];
  },
  // Container images (M8) ship the standalone server; tracing starts at the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../../'),
  // Same-origin API: the browser talks to /api/v1 on this app, so the session cookie is first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiBase}/api/v1/:path*` }];
  },
};

export default config;
