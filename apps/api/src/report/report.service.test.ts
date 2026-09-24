import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ReservationService } from '../reservation/reservation.service.js';
import { addRow, resetDatabase, seedConfig, testPool } from '../db/test-helpers.js';
import { ReportService } from './report.service.js';

let pool: Pool;
let reservations: ReservationService;
let reports: ReportService;

beforeAll(() => {
  pool = testPool();
  reservations = new ReservationService(new AllocationRepository(pool), new LedgerService(pool), pool);
  reports = new ReportService(pool);
});
beforeEach(async () => resetDatabase(pool));
afterAll(async () => pool.end());

describe('ReportService', () => {
  it('reports physical and sellable seats, live holds, sales, releases, and refusals', async () => {
    const { configId } = await seedConfig(pool, 100);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 80 });
    await addRow(pool, configId, { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 });
    const sold = await reservations.reserve({ configId, identity: { kind: 'online' }, quantity: 5, actor: 'test' });
    await reservations.confirm(sold.token, 'BK-REPORT', 'test');
    const released = await reservations.reserve({ configId, identity: { kind: 'counter' }, quantity: 3, actor: 'test' });
    await reservations.release(released.token, 'test');
    const held = await reservations.reserve({ configId, identity: { kind: 'online' }, quantity: 4, actor: 'test' });
    await pool.query("UPDATE slot_holds SET expires_at = now() + interval '2 minutes' WHERE token = $1", [held.token]);
    await expect(reservations.reserve({ configId, identity: { kind: 'counter' }, quantity: 25, actor: 'test' })).rejects.toThrow();

    const report = await reports.forConfig(configId);
    expect(report).toMatchObject({
      physicalCapacity: 100,
      sellableNow: 91,
      heldSeats: 4,
      holdsDueSoon: 4,
      confirmedSales: 5,
      releasedSeats: 3,
      cutoffReturnedSeats: 0,
      preventedOversellAttempts: 1,
    });
    expect(report.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'online', sellableNow: 71, soldSeats: 5, heldSeats: 4 }),
      expect.objectContaining({ channel: 'counter', sellableNow: 20, soldSeats: 0, heldSeats: 0 }),
    ]));
    expect(reports.toCsv(report)).toContain('online');
    expect(reports.toCsv(report)).toContain('"prevented_oversell_attempts","1"');
  });

  it('does not count a funded child twice in sellable capacity', async () => {
    const { configId } = await seedConfig(pool, 100);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 100 });
    await addRow(pool, configId, { channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 });
    const report = await reports.forConfig(configId);
    expect(report.sellableNow).toBe(100);
    expect(report.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'online', sellableNow: 80 }),
      expect.objectContaining({ channel: 'partner_pool', sellableNow: 20 }),
    ]));
  });
});
