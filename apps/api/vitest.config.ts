import { defineConfig } from 'vitest/config';

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://slot:slot@localhost:55432/slot_allocation_test';
const testDatabaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1));
if (!/^[a-z][a-z0-9_]*_test$/.test(testDatabaseName)) {
  throw new Error('TEST_DATABASE_URL must name a database ending in _test');
}

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Tests TRUNCATE between cases, so they get their own database. Without
    // this, `pnpm test` silently wipes the scenarios `pnpm setup` seeded.
    env: {
      DATABASE_URL: testDatabaseUrl,
    },
    environment: 'node',
    // Integration tests share one database; run files serially to keep
    // truncation between tests deterministic.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
