import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { SCENARIOS, applyScenario } from './scenarios.js';
import { checkInvariants } from '@slot/engine';
import { ReservationService } from '../reservation/reservation.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { testPool, resetDatabase } from '../db/test-helpers.js';

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

describe('scenarios', () => {
  it('defines at least the documented set', () => {
    expect(SCENARIOS.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        'double-count-trap',
        'counter-siloed',
        'three-way-split',
        'managed-draws-pool',
        'hidden-owner-keeps-committed',
        'free-for-all',
      ]),
    );
  });

  it.each(SCENARIOS.map((s) => s.key))('seeds %s into a valid tree', async (key) => {
    const { configId, cabinCapacity } = await applyScenario(pool, key);
    const rows = await service.rowsFor(configId);
    expect(checkInvariants(rows, cabinCapacity)).toEqual([]);
  });

  it('makes the double-count trap visible', async () => {
    const { configId } = await applyScenario(pool, 'double-count-trap');
    const trace = await service.preview(configId, { kind: 'online' });
    const rows = await service.rowsFor(configId);
    const onlineRaw = rows.find((r) => r.channel === 'online')!;
    // Raw says 65 free; netting says 30. That gap is the bug this repo is about.
    expect(onlineRaw.allocatedSlots - onlineRaw.soldSlots - onlineRaw.heldSlots).toBe(65);
    expect(trace.candidates[0]!.row.allocatedSlots).toBe(30);
  });
});
