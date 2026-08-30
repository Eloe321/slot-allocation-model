import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { ExpiryService } from './expiry.service.js';
import { ReservationService } from './reservation.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { testPool, resetDatabase, seedConfig, addRow } from '../db/test-helpers.js';

let pool: Pool;
let service: ReservationService;
let expiry: ExpiryService;

beforeAll(() => {
  pool = testPool();
  const repo = new AllocationRepository(pool);
  const ledger = new LedgerService(pool);
  service = new ReservationService(repo, ledger, pool);
  expiry = new ExpiryService(repo, ledger, pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('ExpiryService.sweep', () => {
  it('returns seats from an expired hold', async () => {
    const { configId } = await seedConfig(pool, 50);
    const onlineId = await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 50,
    });
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 6,
      actor: 'test',
    });
    await pool.query(`UPDATE slot_holds SET expires_at = now() - interval '1 minute' WHERE token = $1`, [token]);

    const swept = await expiry.sweep();

    expect(swept).toBe(1);
    const { rows } = await pool.query('SELECT held_slots FROM channel_allocations WHERE id = $1', [
      onlineId,
    ]);
    expect(rows[0].held_slots).toBe(0);
    const status = await pool.query('SELECT status FROM slot_holds WHERE token = $1', [token]);
    expect(status.rows[0].status).toBe('expired');
  });

  it('leaves unexpired holds alone', async () => {
    const { configId } = await seedConfig(pool, 50);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 50 });
    await service.reserve({ configId, identity: { kind: 'online' }, quantity: 6, actor: 'test' });
    expect(await expiry.sweep()).toBe(0);
  });

  it('does not touch confirmed holds even when past expiry', async () => {
    const { configId } = await seedConfig(pool, 50);
    const onlineId = await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 50,
    });
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 6,
      actor: 'test',
    });
    await service.confirm(token, 'BK-1', 'test');
    await pool.query(`UPDATE slot_holds SET expires_at = now() - interval '1 minute' WHERE token = $1`, [token]);

    expect(await expiry.sweep()).toBe(0);
    const { rows } = await pool.query('SELECT sold_slots FROM channel_allocations WHERE id = $1', [
      onlineId,
    ]);
    expect(rows[0].sold_slots).toBe(6);
  });

  it('writes an expire_hold ledger entry', async () => {
    const { configId } = await seedConfig(pool, 50);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 50 });
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 6,
      actor: 'test',
    });
    await pool.query(`UPDATE slot_holds SET expires_at = now() - interval '1 minute' WHERE token = $1`, [token]);
    await expiry.sweep();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM slot_movements WHERE event_type = 'expire_hold'`,
    );
    expect(rows[0].n).toBe(1);
  });
});
