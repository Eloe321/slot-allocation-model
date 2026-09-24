import { describe, it, expect } from 'vitest';
import { row } from './test-support.js';
import { checkInvariants } from './invariants.js';

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
    // The row is also the online parent, so its own overcommitment now trips
    // the online ceiling as well; this test is about the per-row code.
    expect(checkInvariants(rows, 100)).toContainEqual({
      code: 'row_overcommitted',
      rowId: 1,
      detail: 'sold 4 + held 3 exceeds allocated 5',
    });
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
      detail:
        'online-funded children total 30 plus parent committed 0 exceed online parent allocation 10',
    });
  });

  it('flags an online-funded child with no online parent row', () => {
    const rows = [
      row({ id: 1, channel: 'counter', allocatedSlots: 60 }),
      row({ id: 2, channel: 'agency', ownerId: 7, allocationType: 'flexible', allocatedSlots: 20 }),
    ];
    expect(checkInvariants(rows, 60)).toContainEqual({
      code: 'online_child_without_parent',
      rowId: null,
      detail: '1 online-funded child row(s) exist with no online parent row',
    });
  });

  it('flags a partner-funded child with no partner pool row', () => {
    const rows = [
      row({ id: 1, channel: 'online', allocatedSlots: 60 }),
      row({
        id: 2,
        channel: 'agency',
        ownerId: 9,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: 8,
      }),
    ];
    expect(checkInvariants(rows, 60)).toContainEqual({
      code: 'partner_child_without_pool',
      rowId: null,
      detail: '1 partner-funded child row(s) exist with no partner pool row',
    });
  });

  it('flags more than one unowned online direct row', () => {
    const rows = [
      row({ id: 1, channel: 'online', allocatedSlots: 30 }),
      row({ id: 2, channel: 'online', allocatedSlots: 30 }),
    ];
    expect(checkInvariants(rows, 100)).toContainEqual({
      code: 'duplicate_online_parent',
      rowId: null,
      detail: '2 unowned online direct rows; expected at most one',
    });
  });

  it.each(['counter', 'marketplace'] as const)('flags duplicate %s direct rows', (channel) => {
    const rows = [row({ id: 1, channel, allocatedSlots: 10 }), row({ id: 2, channel, allocatedSlots: 10 })];
    expect(checkInvariants(rows, 20)).toContainEqual({
      code: 'duplicate_direct_channel', rowId: null,
      detail: `2 ${channel} direct rows; expected at most one`,
    });
  });

  it('flags more than one partner pool row', () => {
    const rows = [
      row({ id: 1, channel: 'online', allocatedSlots: 60 }),
      row({ id: 2, channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 10 }),
      row({ id: 3, channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 10 }),
    ];
    expect(checkInvariants(rows, 100)).toContainEqual({
      code: 'duplicate_partner_pool',
      rowId: null,
      detail: '2 partner pool rows; expected at most one',
    });
  });

  it('flags two rows sharing an owner, channel and funding source', () => {
    const rows = [
      row({ id: 1, channel: 'online', allocatedSlots: 100 }),
      row({ id: 2, channel: 'agency', ownerId: 7, allocationType: 'guaranteed', allocatedSlots: 10 }),
      row({ id: 3, channel: 'agency', ownerId: 7, allocationType: 'flexible', allocatedSlots: 10 }),
    ];
    expect(checkInvariants(rows, 100)).toContainEqual({
      code: 'duplicate_owner_row',
      rowId: null,
      detail: 'owner 7 holds 2 rows on channel agency; expected at most one',
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
      detail:
        'partner-funded children total 25 plus pool committed 0 exceed partner pool allocation 10',
    });
  });

  it('flags one owner holding rows funded from both pools', () => {
    // Legal under the old (channel, owner, funding) key, and it strands
    // capacity: an owner is managed or ordinary, so exactly one of these two
    // rows can ever be matched — while both are netted out of their parents.
    const rows = [
      row({ id: 1, channel: 'online', allocatedSlots: 80 }),
      row({ id: 2, channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 }),
      row({ id: 3, channel: 'agency', ownerId: 7, allocationType: 'guaranteed', allocatedSlots: 10 }),
      row({
        id: 4,
        channel: 'agency',
        ownerId: 7,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: 10,
      }),
    ];
    expect(checkInvariants(rows, 100)).toContainEqual({
      code: 'duplicate_owner_row',
      rowId: null,
      detail: 'owner 7 holds 2 rows on channel agency; expected at most one',
    });
  });
});
