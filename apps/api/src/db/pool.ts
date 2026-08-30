import { Pool } from 'pg';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://slot:slot@localhost:55432/slot_allocation';

export function createPool(): Pool {
  return new Pool({ connectionString: DATABASE_URL, max: 20 });
}
