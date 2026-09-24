import type { Pool } from 'pg';
import { createPool } from './pool.js';

export function testPool(): Pool {
  return createPool();
}

export async function resetDatabase(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ database_name: string }>('SELECT current_database() AS database_name');
  const name = rows[0]?.database_name;
  if (!name || !/^[a-z][a-z0-9_]*_test$/.test(name)) {
    throw new Error(`Refusing to reset non-test database: ${name ?? 'unknown'}`);
  }
  await pool.query(`
    TRUNCATE crm_webhook_attempts, crm_webhook_deliveries, reservation_refusals, demo_sessions, configuration_requests, slot_movements, booking_slot_links, slot_holds,
             channel_allocations, allocation_configs, voyages, cabins, vessels, owners
    RESTART IDENTITY CASCADE
  `);
}

export interface SeededConfig {
  configId: number;
  cabinCapacity: number;
}

/** Creates one vessel, cabin, voyage, and empty config. */
export async function seedConfig(pool: Pool, capacity = 100): Promise<SeededConfig> {
  const { rows } = await pool.query<{ id: string }>(
    `WITH v AS (INSERT INTO vessels (name) VALUES ('MV Test') RETURNING id),
          c AS (INSERT INTO cabins (vessel_id, name, capacity)
                SELECT id, 'Economy', $1 FROM v RETURNING id, vessel_id),
          t AS (INSERT INTO voyages (vessel_id, departure_port, departs_at, booking_cutoff_at)
                SELECT vessel_id, 'Port A', now() + interval '2 days', now() + interval '1 day'
                FROM c RETURNING id)
     INSERT INTO allocation_configs (voyage_id, cabin_id, cabin_capacity)
     SELECT t.id, c.id, $1 FROM t, c RETURNING id`,
    [capacity],
  );
  return { configId: Number(rows[0]!.id), cabinCapacity: capacity };
}

export async function addRow(
  pool: Pool,
  configId: number,
  row: {
    channel: string;
    allocationType: string;
    allocatedSlots: number;
    ownerId?: number | null;
    fundingSource?: string;
    soldSlots?: number;
    heldSlots?: number;
  },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO channel_allocations
       (config_id, channel, owner_id, allocation_type, funding_source,
        allocated_slots, sold_slots, held_slots)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      configId,
      row.channel,
      row.ownerId ?? null,
      row.allocationType,
      row.fundingSource ?? 'online',
      row.allocatedSlots,
      row.soldSlots ?? 0,
      row.heldSlots ?? 0,
    ],
  );
  return Number(rows[0]!.id);
}

export async function addOwner(pool: Pool, name: string, isHidden = false): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO owners (name, is_hidden) VALUES ($1,$2) RETURNING id',
    [name, isHidden],
  );
  return Number(rows[0]!.id);
}
