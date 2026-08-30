import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Tests TRUNCATE between cases, so they get their own database. Without
    // this, `pnpm test` silently wipes the scenarios `pnpm setup` seeded.
    env: {
      DATABASE_URL: 'postgres://slot:slot@localhost:55432/slot_allocation_test',
    },
    environment: 'node',
    // Integration tests share one database; run files serially to keep
    // truncation between tests deterministic.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
