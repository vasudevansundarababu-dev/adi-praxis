import type { NextConfig } from 'next';
import path from 'node:path';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  // Lets a verification build run beside `next dev` without clobbering its .next folder.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@praxis/shared'],
  // Container images (M8) ship the standalone server; tracing starts at the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../../'),
  // Same-origin API: the browser talks to /api/v1 on this app, so the session cookie is first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiBase}/api/v1/:path*` }];
  },
};

export default config;
