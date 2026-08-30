import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { ReservationService } from './reservation.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ReservationNotFoundError, ReservationNotOpenError } from './errors.js';
import { testPool, resetDatabase, seedConfig, addRow } from '../db/test-helpers.js';

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

async function simpleConfig(): Promise<{ configId: number; onlineId: number }> {
  const { configId } = await seedConfig(pool, 50);
  const onlineId = await addRow(pool, configId, {
    channel: 'online',
    allocationType: 'direct',
    allocatedSlots: 50,
  });
  return { configId, onlineId };
}

describe('confirm', () => {
  it('moves held seats to sold and writes a durable link', async () => {
    const { configId, onlineId } = await simpleConfig();
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 4,
      actor: 'test',
    });

    await service.confirm(token, 'BK-1', 'test');

    const { rows } = await pool.query(
      'SELECT sold_slots, held_slots FROM channel_allocations WHERE id = $1',
      [onlineId],
    );
    expect(rows[0]).toMatchObject({ sold_slots: 4, held_slots: 0 });

    const links = await pool.query(
      'SELECT allocation_id, quantity FROM booking_slot_links WHERE booking_ref = $1',
      ['BK-1'],
    );
    expect(links.rows).toEqual([{ allocation_id: String(onlineId), quantity: 4 }]);
  });

  it('is idempotent when every row is already confirmed', async () => {
    const { configId } = await simpleConfig();
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 4,
      actor: 'test',
    });
    await service.confirm(token, 'BK-1', 'test');
    await expect(service.confirm(token, 'BK-1', 'test')).resolves.toMatchObject({
      alreadyConfirmed: true,
    });
    const { rows } = await pool.query('SELECT sold_slots FROM channel_allocations');
    expect(rows[0].sold_slots).toBe(4);
  });

  it('rejects an unknown token', async () => {
    await expect(
      service.confirm('00000000-0000-0000-0000-000000000000', 'BK-1', 'test'),
    ).rejects.toBeInstanceOf(ReservationNotFoundError);
  });
});

describe('release', () => {
  it('returns held seats to the exact source rows', async () => {
    const { configId, onlineId } = await simpleConfig();
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 4,
      actor: 'test',
    });

    await service.release(token, 'test');

    const { rows } = await pool.query('SELECT held_slots FROM channel_allocations WHERE id = $1', [
      onlineId,
    ]);
    expect(rows[0].held_slots).toBe(0);
  });

  it('refuses to release a confirmed reservation', async () => {
    const { configId } = await simpleConfig();
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 4,
      actor: 'test',
    });
    await service.confirm(token, 'BK-1', 'test');
    await expect(service.release(token, 'test')).rejects.toBeInstanceOf(ReservationNotOpenError);
  });

  it('never increases sales through a released token', async () => {
    const { configId } = await simpleConfig();
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 4,
      actor: 'test',
    });
    await service.release(token, 'test');
    await expect(service.confirm(token, 'BK-1', 'test')).rejects.toBeInstanceOf(
      ReservationNotOpenError,
    );
    const { rows } = await pool.query('SELECT sold_slots FROM channel_allocations');
    expect(rows[0].sold_slots).toBe(0);
  });
});
