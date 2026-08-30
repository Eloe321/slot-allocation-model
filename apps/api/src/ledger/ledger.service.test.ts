import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { LedgerService } from './ledger.service.js';
import { testPool, resetDatabase, seedConfig, addRow } from '../db/test-helpers.js';

let pool: Pool;
let ledger: LedgerService;

beforeAll(() => {
  pool = testPool();
  ledger = new LedgerService(pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('LedgerService', () => {
  it('appends a movement and reads it back newest first', async () => {
    const { configId } = await seedConfig(pool);
    const rowId = await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 10,
    });
    const client = await pool.connect();
    try {
      await ledger.record(client, {
        configId,
        allocationId: rowId,
        eventType: 'reserve',
        quantity: 3,
        actor: 'test',
        reason: 'unit test',
      });
    } finally {
      client.release();
    }

    const entries = await ledger.forConfig(configId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      eventType: 'reserve',
      quantity: 3,
      actor: 'test',
      allocationId: rowId,
    });
  });

  it('returns an empty list for a config with no movements', async () => {
    const { configId } = await seedConfig(pool);
    expect(await ledger.forConfig(configId)).toEqual([]);
  });
});
