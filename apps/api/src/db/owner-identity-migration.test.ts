import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { resetDatabase, seedConfig, testPool } from './test-helpers.js';

let pool: Pool;
beforeAll(() => { pool = testPool(); });
beforeEach(async () => { await resetDatabase(pool); });
afterAll(async () => { await pool.end(); });

describe('visible owner migration', () => {
  it('preserves refusal attribution when duplicate partner IDs merge', async () => {
    const { configId } = await seedConfig(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DROP INDEX one_visible_owner_per_name');
      const original = await client.query<{ id: string }>("INSERT INTO owners (name) VALUES ('Harbour Travel') RETURNING id");
      const duplicate = await client.query<{ id: string }>("INSERT INTO owners (name) VALUES (' harbour travel ') RETURNING id");
      const originalId = original.rows[0]!.id;
      const duplicateId = duplicate.rows[0]!.id;
      await client.query(
        `INSERT INTO channel_allocations (config_id, channel, allocation_type, allocated_slots)
         VALUES ($1, 'online', 'direct', 80)`, [configId],
      );
      await client.query(
        `INSERT INTO channel_allocations (config_id, channel, owner_id, allocation_type, allocated_slots)
         VALUES ($1, 'agency', $2, 'guaranteed', 10)`, [configId, duplicateId],
      );
      await client.query(
        `INSERT INTO reservation_refusals (config_id, channel, owner_id, requested, available, shortfall, actor)
         VALUES ($1, 'agency', $2, 15, 10, 5, 'test')`, [configId, duplicateId],
      );
      await client.query(
        `INSERT INTO demo_sessions (token_hash, role, owner_id, expires_at)
         VALUES ('migration-test', 'partner', $1, now() + interval '1 hour')`, [duplicateId],
      );
      const migration = await readFile(new URL('../../drizzle/migrations/0011_visible_owner_identity.sql', import.meta.url), 'utf8');
      await client.query(migration);
      const refusal = await client.query<{ owner_id: string }>('SELECT owner_id FROM reservation_refusals');
      const allocation = await client.query<{ owner_id: string }>("SELECT owner_id FROM channel_allocations WHERE channel = 'agency'");
      const session = await client.query<{ owner_id: string }>('SELECT owner_id FROM demo_sessions');
      expect(refusal.rows[0]!.owner_id).toBe(originalId);
      expect(allocation.rows[0]!.owner_id).toBe(originalId);
      expect(session.rows[0]!.owner_id).toBe(originalId);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
