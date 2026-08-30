import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { ReservationService } from './reservation.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InsufficientCapacityError } from './errors.js';
import { checkInvariants, type AllocationRow } from '@slot/engine';
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

async function loadRows(configId: number): Promise<AllocationRow[]> {
  const { rows } = await pool.query(
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

describe('oversell under concurrency', () => {
  it('grants exactly the available seats when 50 requests race for 10', async () => {
    const { configId } = await seedConfig(pool, 10);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 10 });

    const attempts = Array.from({ length: 50 }, () =>
      service
        .reserve({ configId, identity: { kind: 'online' }, quantity: 1, actor: 'race' })
        .then(() => 'granted' as const)
        .catch((error: unknown) =>
          error instanceof InsufficientCapacityError ? ('refused' as const) : Promise.reject(error),
        ),
    );

    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'granted')).toHaveLength(10);
    expect(results.filter((r) => r === 'refused')).toHaveLength(40);

    const rows = await loadRows(configId);
    expect(rows[0]!.heldSlots).toBe(10);
    expect(checkInvariants(rows, 10)).toEqual([]);
  });

  it('keeps the ledger consistent with the counters under contention', async () => {
    const { configId } = await seedConfig(pool, 30);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 30 });

    await Promise.all(
      Array.from({ length: 40 }, () =>
        service
          .reserve({ configId, identity: { kind: 'online' }, quantity: 2, actor: 'race' })
          .catch((error: unknown) => {
            if (!(error instanceof InsufficientCapacityError)) throw error;
          }),
      ),
    );

    const { rows: ledgerTotal } = await pool.query<{ total: string | null }>(
      `SELECT SUM(quantity)::text AS total FROM slot_movements
        WHERE config_id = $1 AND event_type = 'reserve'`,
      [configId],
    );
    const rows = await loadRows(configId);
    expect(Number(ledgerTotal[0]!.total ?? 0)).toBe(rows[0]!.heldSlots);
    expect(checkInvariants(rows, 30)).toEqual([]);
  });

  it('does not oversell when concurrent requests split across the tree', async () => {
    const { configId } = await seedConfig(pool, 40);
    const managedOwner = await addOwner(pool, 'Managed Nine');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 40 });
    await addRow(pool, configId, {
      channel: 'partner_pool',
      allocationType: 'flexible',
      allocatedSlots: 15,
    });
    await addRow(pool, configId, {
      channel: 'agency',
      ownerId: managedOwner,
      allocationType: 'guaranteed',
      fundingSource: 'partner_pool',
      allocatedSlots: 5,
    });

    const identity = {
      kind: 'owner' as const,
      channel: 'agency' as const,
      ownerId: managedOwner,
      managed: true,
    };
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        service
          .reserve({ configId, identity, quantity: 3, actor: 'race' })
          .then(() => 'granted' as const)
          .catch((error: unknown) =>
            error instanceof InsufficientCapacityError
              ? ('refused' as const)
              : Promise.reject(error),
          ),
      ),
    );

    const rows = await loadRows(configId);
    const totalHeld = rows.reduce((t, r) => t + r.heldSlots, 0);
    expect(totalHeld).toBe(results.filter((r) => r === 'granted').length * 3);
    // 5 own + 10 netted pool + 25 netted online = 40 physical seats.
    expect(totalHeld).toBeLessThanOrEqual(40);
    expect(checkInvariants(rows, 40)).toEqual([]);
  });
});
