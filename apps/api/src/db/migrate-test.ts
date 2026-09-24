process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://slot:slot@localhost:55432/slot_allocation_test';

await import('./migrate.js');
