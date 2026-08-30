import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { checkInvariants, type AllocationRow } from '@slot/engine';
import { CutoffService } from './cutoff.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { testPool, resetDatabase, seedConfig, addRow, addOwner } from '../db/test-helpers.js';

let pool: Pool;
let cutoff: CutoffService;

beforeAll(() => {
  pool = testPool();
  cutoff = new CutoffService(new AllocationRepository(pool), new LedgerService(pool), pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

async function cutoffTree() {
  const { configId } = await seedConfig(pool, 100);
  const a = await addOwner(pool, 'Flexible Agency');
  const g = await addOwner(pool, 'Guaranteed Agency');
  const ids = {
    counter: await addRow(pool, configId, {
      channel: 'counter',
      allocationType: 'direct',
      allocatedSlots: 10,
    }),
    online: await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 90,
      soldSlots: 5,
    }),
    flexible: await addRow(pool, configId, {
      channel: 'agency',
      ownerId: a,
      allocationType: 'flexible',
      allocatedSlots: 20,
      soldSlots: 3,
    }),
    guaranteed: await addRow(pool, configId, {
      channel: 'agency',
      ownerId: g,
      allocationType: 'guaranteed',
      allocatedSlots: 15,
      soldSlots: 2,
    }),
  };
  return { configId, ids };
}

async function cutoffTreeWithCapacity() {
  const t = await cutoffTree();
  return { configId: t.configId, cabinCapacity: 100 };
}

async function loadEngineRows(p: Pool, configId: number): Promise<AllocationRow[]> {
  const { rows } = await p.query(
    `SELECT a.id, a.channel, a.owner_id, a.allocation_type, a.funding_source,
            a.allocated_slots, a.sold_slots, a.held_slots, o.is_hidden AS owner_is_hidden
       FROM channel_allocations a LEFT JOIN owners o ON o.id = a.owner_id
      WHERE a.config_id = $1 ORDER BY a.id`,
    [configId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    channel: r.channel,
    ownerId: r.owner_id === null ? null : Number(r.owner_id),
    allocationType: r.allocation_type,
    fundingSource: r.funding_source,
    allocatedSlots: r.allocated_slots,
    soldSlots: r.sold_slots,
    heldSlots: r.held_slots,
    ownerIsHidden: r.owner_is_hidden ?? false,
  }));
}

describe('CutoffService.apply', () => {
  it('moves the free portion of flexible rows to counter', async () => {
    const { configId, ids } = await cutoffTree();
    await cutoff.apply(configId, 'test');
    const { rows } = await pool.query(
      'SELECT id, allocated_slots FROM channel_allocations WHERE config_id = $1 ORDER BY id',
      [configId],
    );
    const byId = Object.fromEntries(rows.map((r) => [Number(r.id), r.allocated_slots]));
    // flexible: 20 allocated, 3 sold -> 17 movable, leaving 3.
    expect(byId[ids.flexible]).toBe(3);
  });

  it('leaves guaranteed rows untouched', async () => {
    const { configId, ids } = await cutoffTree();
    await cutoff.apply(configId, 'test');
    const { rows } = await pool.query(
      'SELECT allocated_slots FROM channel_allocations WHERE id = $1',
      [ids.guaranteed],
    );
    expect(rows[0].allocated_slots).toBe(15);
  });

  it('accumulates every movable seat on the counter row', async () => {
    const { configId, ids } = await cutoffTree();
    await cutoff.apply(configId, 'test');
    const { rows } = await pool.query(
      'SELECT allocated_slots FROM channel_allocations WHERE id = $1',
      [ids.counter],
    );
    // online's NETTED free is 90 - 35 children - 5 sold = 50, not 85: the raw
    // 85 includes seats its children already hold. Plus flexible's 17.
    // 10 + 50 + 17 = 77.
    expect(rows[0].allocated_slots).toBe(77);
  });

  it('is idempotent', async () => {
    const { configId, ids } = await cutoffTree();
    await cutoff.apply(configId, 'test');
    await cutoff.apply(configId, 'test');
    const { rows } = await pool.query(
      'SELECT allocated_slots FROM channel_allocations WHERE id = $1',
      [ids.counter],
    );
    expect(rows[0].allocated_slots).toBe(77);
  });

  it('shrinks the parent by what its child released', async () => {
    const { configId, ids } = await cutoffTree();
    await cutoff.apply(configId, 'test');
    const { rows } = await pool.query(
      'SELECT sold_slots, allocated_slots FROM channel_allocations WHERE id = $1',
      [ids.online],
    );
    // 90 - 50 (own netted free) - 17 (returned by the flexible child) = 23,
    // which is exactly children(3 + 15) + sold(5). Sold seats never move.
    expect(rows[0]).toMatchObject({ sold_slots: 5, allocated_slots: 23 });
  });

  it('leaves the partition intact, so every invariant still holds', async () => {
    const { configId, cabinCapacity } = await cutoffTreeWithCapacity();
    await cutoff.apply(configId, 'test');
    const rows = await loadEngineRows(pool, configId);
    // The whole point of netting the release: cutoff rewrites more rows than
    // any other operation, and must not be the thing that breaks the tree.
    expect(checkInvariants(rows, cabinCapacity)).toEqual([]);
    const directSum = rows
      .filter((r) => r.allocationType === 'direct')
      .reduce((t, r) => t + r.allocatedSlots, 0);
    expect(directSum).toBe(cabinCapacity);
  });
});
