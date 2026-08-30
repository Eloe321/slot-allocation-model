import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { testPool, resetDatabase, seedConfig, addRow, addOwner } from './test-helpers.js';

let pool: Pool;

beforeAll(() => {
  pool = testPool();
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('pool ceiling constraints', () => {
  it('rejects online children exceeding the online parent', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Agency Seven');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 10 });
    await expect(
      addRow(pool, configId, {
        channel: 'agency',
        ownerId,
        allocationType: 'flexible',
        allocatedSlots: 30,
      }),
    ).rejects.toThrow(/online-funded children/);
  });

  it('counts the parent own committed seats against the ceiling', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Agency Seven');
    // Parent allocates 100 but has already sold 60. Only 40 remains to carve.
    await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 100,
      soldSlots: 60,
    });
    await expect(
      addRow(pool, configId, {
        channel: 'agency',
        ownerId,
        allocationType: 'guaranteed',
        allocatedSlots: 50,
      }),
    ).rejects.toThrow(/plus parent committed/);
  });

  it('rejects partner children exceeding the pool', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Managed Nine');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 50 });
    await addRow(pool, configId, {
      channel: 'partner_pool',
      allocationType: 'flexible',
      allocatedSlots: 10,
    });
    await expect(
      addRow(pool, configId, {
        channel: 'agency',
        ownerId,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: 25,
      }),
    ).rejects.toThrow(/partner-funded children/);
  });

  it('rejects an online-funded child with no online parent row', async () => {
    const { configId } = await seedConfig(pool, 60);
    const ownerId = await addOwner(pool, 'Orphan Agency');
    await addRow(pool, configId, { channel: 'counter', allocationType: 'direct', allocatedSlots: 60 });
    await expect(
      addRow(pool, configId, {
        channel: 'agency',
        ownerId,
        allocationType: 'flexible',
        allocatedSlots: 20,
      }),
    ).rejects.toThrow(/no online parent row/);
  });

  it('rejects a partner-funded child with no partner pool row', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Orphan Managed');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 80 });
    await expect(
      addRow(pool, configId, {
        channel: 'agency',
        ownerId,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: 10,
      }),
    ).rejects.toThrow(/no partner pool row/);
  });

  it('rejects a second online direct row on one config', async () => {
    const { configId } = await seedConfig(pool);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 50 });
    await expect(
      addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 10 }),
    ).rejects.toThrow(/one_online_parent_per_config/);
  });

  it('rejects a second partner pool row on one config', async () => {
    const { configId } = await seedConfig(pool);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 80 });
    await addRow(pool, configId, {
      channel: 'partner_pool',
      allocationType: 'flexible',
      allocatedSlots: 20,
    });
    await expect(
      addRow(pool, configId, {
        channel: 'partner_pool',
        allocationType: 'flexible',
        allocatedSlots: 5,
      }),
    ).rejects.toThrow(/one_partner_pool_per_config/);
  });

  it('rejects two rows for the same owner, channel and funding', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Agency Seven');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 80 });
    await addRow(pool, configId, {
      channel: 'agency',
      ownerId,
      allocationType: 'guaranteed',
      allocatedSlots: 10,
    });
    await expect(
      addRow(pool, configId, {
        channel: 'agency',
        ownerId,
        allocationType: 'flexible',
        allocatedSlots: 10,
      }),
    ).rejects.toThrow(/one_row_per_owner_channel_funding/);
  });

  it('permits a transiently invalid edit that balances by commit', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Agency Seven');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 40 });
    const childId = await addRow(pool, configId, {
      channel: 'agency',
      ownerId,
      allocationType: 'flexible',
      allocatedSlots: 30,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Transiently 60 > 40. An immediate constraint would reject this here.
      await client.query('UPDATE channel_allocations SET allocated_slots = 60 WHERE id = $1', [
        childId,
      ]);
      await client.query(
        `UPDATE channel_allocations SET allocated_slots = 70
          WHERE config_id = $1 AND channel = 'online'`,
        [configId],
      );
      await expect(client.query('COMMIT')).resolves.toBeDefined();
    } finally {
      client.release();
    }
  });

  it('stops applying the ceiling after cutoff', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Agency Seven');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 40 });
    await addRow(pool, configId, {
      channel: 'agency',
      ownerId,
      allocationType: 'guaranteed',
      allocatedSlots: 30,
    });
    await pool.query('UPDATE allocation_configs SET cutoff_applied_at = now() WHERE id = $1', [
      configId,
    ]);
    // The parent is legitimately drained to zero while the guaranteed child remains.
    await expect(
      pool.query(
        `UPDATE channel_allocations SET allocated_slots = 0
          WHERE config_id = $1 AND channel = 'online'`,
        [configId],
      ),
    ).resolves.toBeDefined();
  });
});
