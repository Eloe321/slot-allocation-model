import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { AllocationRepository } from './allocation.repository.js';
import { testPool, resetDatabase, seedConfig, addRow, addOwner } from '../db/test-helpers.js';

let pool: Pool;
let repo: AllocationRepository;

beforeAll(() => {
  pool = testPool();
  repo = new AllocationRepository(pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('AllocationRepository', () => {
  it('loads rows in engine shape, ordered by id', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Agency Seven');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 65 });
    await addRow(pool, configId, { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 });
    await addRow(pool, configId, {
      channel: 'agency',
      ownerId,
      allocationType: 'guaranteed',
      allocatedSlots: 10,
    });

    const loaded = await repo.withLockedConfig(configId, async (ctx) => ctx.rows);

    expect(loaded.map((r) => r.channel)).toEqual(['online', 'counter', 'agency']);
    expect(loaded[0]).toMatchObject({
      channel: 'online',
      ownerId: null,
      allocationType: 'direct',
      fundingSource: 'online',
      allocatedSlots: 65,
      soldSlots: 0,
      heldSlots: 0,
      ownerIsHidden: false,
    });
  });

  it('reports a hidden owner on the row', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Masked', true);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 65 });
    await addRow(pool, configId, {
      channel: 'agency',
      ownerId,
      allocationType: 'flexible',
      allocatedSlots: 10,
    });

    const loaded = await repo.withLockedConfig(configId, async (ctx) => ctx.rows);
    expect(loaded.find((r) => r.channel === 'agency')?.ownerIsHidden).toBe(true);
  });

  it('throws for an unknown config', async () => {
    await expect(repo.withLockedConfig(999_999, async () => null)).rejects.toThrow(
      'allocation config 999999 not found',
    );
  });

  it('rolls back every write when the callback throws', async () => {
    const { configId } = await seedConfig(pool);
    const rowId = await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 65,
    });

    await expect(
      repo.withLockedConfig(configId, async (ctx) => {
        await ctx.applyDelta(rowId, { heldDelta: 5 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const after = await repo.withLockedConfig(configId, async (ctx) => ctx.rows);
    expect(after[0]?.heldSlots).toBe(0);
  });
});
