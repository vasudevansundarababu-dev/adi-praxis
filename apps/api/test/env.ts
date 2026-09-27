import path from 'node:path';

// Tests use the dedicated praxis_test database, never the dev database. Defaults match docker-compose.yml.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../../.env'));
} catch {
  // CI: no .env file
}

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://praxis:praxis@localhost:5442/praxis_test';
export const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6389';

if (!/\/praxis_test(\?|$)/.test(TEST_DATABASE_URL)) {
  throw new Error(`Refusing to run tests against ${TEST_DATABASE_URL}: database name must be praxis_test`);
}
