import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { TEST_DATABASE_URL } from './env';

/**
 * Applies any pending migrations to the praxis_test database (non-destructive `migrate deploy`).
 * Each test file then empties the tables it relies on via resetDb().
 */
export default function setup() {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
