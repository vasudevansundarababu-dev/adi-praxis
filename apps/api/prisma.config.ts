import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Load the repo-root .env for local dev; variables already set in the environment win.
try {
  process.loadEnvFile(path.resolve(process.cwd(), '../../.env'));
} catch {
  // No .env file (CI, containers): rely on the real environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
