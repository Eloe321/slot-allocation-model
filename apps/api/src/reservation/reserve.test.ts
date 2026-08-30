import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { ReservationService } from './reservation.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InsufficientCapacityError } from './errors.js';
import { testPool, resetDatabase, seedConfig, addRow, addOwner } from '../db/test-helpers.js';

let pool: Pool;
let service: ReservationService;

beforeAll(() => {
  pool = testPool();
  service = new ReservationService(new AllocationRepository(pool), new LedgerService(pool), pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

// Return type is inferred deliberately: annotating `ids` as Record<string, number>
// widens every property access to `number | undefined` under
// noUncheckedIndexedAccess, which the strict identity types then reject.
async function tree() {
  const { configId } = await seedConfig(pool, 100);
  const ordinary = await addOwner(pool, 'Agency Seven');
  const managedOwner = await addOwner(pool, 'Managed Nine');
  const ids = {
    counter: await addRow(pool, configId, {
      channel: 'counter',
      allocationType: 'direct',
      allocatedSlots: 20,
    }),
    online: await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 80,
    }),
    pool: await addRow(pool, configId, {
      channel: 'partner_pool',
      allocationType: 'flexible',
      allocatedSlots: 20,
    }),
    agency: await addRow(pool, configId, {
      channel: 'agency',
      ownerId: ordinary,
      allocationType: 'guaranteed',
      allocatedSlots: 10,
    }),
    managed: await addRow(pool, configId, {
      channel: 'agency',
      ownerId: managedOwner,
      allocationType: 'guaranteed',
      fundingSource: 'partner_pool',
      allocatedSlots: 8,
    }),
    ordinaryOwnerId: ordinary,
    managedOwnerId: managedOwner,
  };
  return { configId, ids };
}

describe('ReservationService.reserve', () => {
  it('holds seats on the requester own row', async () => {
    const { configId, ids } = await tree();
    const result = await service.reserve({
      configId,
      identity: { kind: 'owner', channel: 'agency', ownerId: ids.ordinaryOwnerId, managed: false },
      quantity: 4,
      actor: 'test',
    });

    expect(result.splits).toEqual([{ rowId: ids.agency, step: 'primary', quantity: 4 }]);
    const { rows } = await pool.query('SELECT held_slots FROM channel_allocations WHERE id = $1', [
      ids.agency,
    ]);
    expect(rows[0].held_slots).toBe(4);
  });

  it('splits across own row, pool, then online for a managed owner', async () => {
    const { configId, ids } = await tree();
    const result = await service.reserve({
      configId,
      identity: { kind: 'owner', channel: 'agency', ownerId: ids.managedOwnerId, managed: true },
      quantity: 25,
      actor: 'test',
    });

    expect(result.splits).toEqual([
      { rowId: ids.managed, step: 'primary', quantity: 8 },
      { rowId: ids.pool, step: 'partner_pool', quantity: 12 },
      { rowId: ids.online, step: 'online_remainder', quantity: 5 },
    ]);
  });

  it('writes one ledger entry per split', async () => {
    const { configId, ids } = await tree();
    await service.reserve({
      configId,
      identity: { kind: 'owner', channel: 'agency', ownerId: ids.managedOwnerId, managed: true },
      quantity: 25,
      actor: 'test',
    });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM slot_movements
        WHERE config_id = $1 AND event_type = 'reserve'`,
      [configId],
    );
    expect(rows[0].n).toBe(3);
  });

  it('refuses to spill counter into any other pool', async () => {
    const { configId } = await tree();
    await expect(
      service.reserve({ configId, identity: { kind: 'counter' }, quantity: 25, actor: 'test' }),
    ).rejects.toBeInstanceOf(InsufficientCapacityError);
  });

  it('reports available capacity on shortfall', async () => {
    const { configId } = await tree();
    await expect(
      service.reserve({ configId, identity: { kind: 'counter' }, quantity: 25, actor: 'test' }),
    ).rejects.toMatchObject({ requested: 25, available: 20, shortfall: 5 });
  });

  it('leaves no held seats behind when it fails', async () => {
    const { configId, ids } = await tree();
    await expect(
      service.reserve({ configId, identity: { kind: 'counter' }, quantity: 25, actor: 'test' }),
    ).rejects.toThrow();
    const { rows } = await pool.query('SELECT held_slots FROM channel_allocations WHERE id = $1', [
      ids.counter,
    ]);
    expect(rows[0].held_slots).toBe(0);
  });
});
