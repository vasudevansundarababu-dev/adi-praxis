import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(__dirname), 'server-only': path.resolve(__dirname, 'test/server-only-stub.ts') } },
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'node', passWithNoTests: true },
});
