import type { NextConfig } from 'next';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  transpilePackages: ['@praxis/shared'],
  // Same-origin API: the browser talks to /api/v1 on this app, so the session cookie is first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiBase}/api/v1/:path*` }];
  },
};

export default config;
