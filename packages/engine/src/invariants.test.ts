import { describe, it, expect } from 'vitest';
import { checkInvariants } from './invariants.js';
import type { AllocationRow } from './types.js';

function row(over: Partial<AllocationRow> = {}): AllocationRow {
  return {
    id: 1,
    channel: 'online',
    ownerId: null,
    allocationType: 'direct',
    fundingSource: 'online',
    allocatedSlots: 0,
    soldSlots: 0,
    heldSlots: 0,
    ownerIsHidden: false,
    ...over,
  };
}

describe('checkInvariants', () => {
  it('accepts a well-formed tree', () => {
    const rows = [
      row({ id: 1, channel: 'counter', allocatedSlots: 20 }),
      row({ id: 2, channel: 'marketplace', allocatedSlots: 15 }),
      row({ id: 3, channel: 'online', allocatedSlots: 65 }),
      row({ id: 4, channel: 'agency', ownerId: 7, allocationType: 'guaranteed', allocatedSlots: 10 }),
      row({ id: 5, channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 }),
      row({
        id: 6,
        channel: 'agency',
        ownerId: 9,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: 8,
      }),
    ];
    expect(checkInvariants(rows, 100)).toEqual([]);
  });

  it('flags a row committed beyond its allocation', () => {
    const rows = [row({ id: 1, allocatedSlots: 5, soldSlots: 4, heldSlots: 3 })];
    expect(checkInvariants(rows, 100)).toEqual([
      { code: 'row_overcommitted', rowId: 1, detail: 'sold 4 + held 3 exceeds allocated 5' },
    ]);
  });

  it('flags direct allocations exceeding cabin capacity', () => {
    const rows = [
      row({ id: 1, channel: 'counter', allocatedSlots: 60 }),
      row({ id: 2, channel: 'online', allocatedSlots: 60 }),
    ];
    expect(checkInvariants(rows, 100)).toContainEqual({
      code: 'direct_exceeds_capacity',
      rowId: null,
      detail: 'direct allocations total 120, cabin capacity is 100',
    });
  });

  it('flags online children exceeding the online parent', () => {
    const rows = [
      row({ id: 1, channel: 'online', allocatedSlots: 10 }),
      row({ id: 2, channel: 'agency', ownerId: 7, allocationType: 'flexible', allocatedSlots: 30 }),
    ];
    expect(checkInvariants(rows, 100)).toContainEqual({
      code: 'online_children_exceed_parent',
      rowId: null,
      detail: 'online-funded children total 30, online parent allocates 10',
    });
  });

  it('flags partner children exceeding the pool', () => {
    const rows = [
      row({ id: 1, channel: 'online', allocatedSlots: 50 }),
      row({ id: 2, channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 10 }),
      row({
        id: 3,
        channel: 'agency',
        ownerId: 9,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: 25,
      }),
    ];
    expect(checkInvariants(rows, 100)).toContainEqual({
      code: 'partner_children_exceed_pool',
      rowId: null,
      detail: 'partner-funded children total 25, partner pool allocates 10',
    });
  });
});
