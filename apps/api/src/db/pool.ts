import { Pool } from 'pg';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://slot:slot@localhost:55432/slot_allocation';

export function createPool(): Pool {
  return new Pool({
    connectionString: DATABASE_URL,
    max: 20,
    // A hosted service needs a bounded failure here. Otherwise an unreachable
    // database leaves the migration process waiting while the platform reports
    // only that no HTTP port was opened.
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * DI token for the shared `Pool`. `Pool` itself cannot be used as a Nest
 * injection token here: every service imports it with `import type`, so
 * `emitDecoratorMetadata` has no runtime value to reflect and falls back to
 * `Function`, which Nest cannot resolve to a provider — the constructor
 * argument is silently injected as `undefined` instead of throwing. An
 * explicit `@Inject(PG_POOL)` on every such parameter sidesteps type
 * reflection entirely.
 */
export const PG_POOL = Symbol('PG_POOL');
