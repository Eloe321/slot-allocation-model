import { describe, it, expect } from 'vitest';
import { rawAvailable } from './tree.js';
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

describe('rawAvailable', () => {
  it('subtracts sold and held from allocated', () => {
    expect(rawAvailable(row({ allocatedSlots: 10, soldSlots: 3, heldSlots: 2 }))).toBe(5);
  });

  it('never returns a negative number', () => {
    expect(rawAvailable(row({ allocatedSlots: 5, soldSlots: 4, heldSlots: 4 }))).toBe(0);
  });
});

export { row };

import { sumOnlineFundedChildren, netOnlineRow } from './tree.js';

describe('sumOnlineFundedChildren', () => {
  it('counts flexible and guaranteed children funded from online', () => {
    const rows = [
      row({ id: 1, allocationType: 'direct', allocatedSlots: 65 }),
      row({ id: 2, channel: 'agency', ownerId: 7, allocationType: 'guaranteed', allocatedSlots: 10 }),
      row({ id: 3, channel: 'reseller', ownerId: 3, allocationType: 'flexible', allocatedSlots: 5 }),
      row({ id: 4, channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 }),
    ];
    expect(sumOnlineFundedChildren(rows)).toBe(35);
  });

  it('excludes direct parents', () => {
    const rows = [
      row({ id: 1, allocationType: 'direct', allocatedSlots: 65 }),
      row({ id: 2, channel: 'counter', allocationType: 'direct', allocatedSlots: 20 }),
    ];
    expect(sumOnlineFundedChildren(rows)).toBe(0);
  });

  it('excludes partner-funded children, which draw the pool instead', () => {
    const rows = [
      row({
        id: 5,
        channel: 'agency',
        ownerId: 9,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: 8,
      }),
    ];
    expect(sumOnlineFundedChildren(rows)).toBe(0);
  });
});

describe('netOnlineRow', () => {
  it('reduces effective allocation by the children carved out of it', () => {
    const online = row({ allocatedSlots: 65 });
    expect(netOnlineRow(online, 35).allocatedSlots).toBe(30);
  });

  it('never nets below what the parent has already committed', () => {
    const online = row({ allocatedSlots: 65, soldSlots: 40, heldSlots: 5 });
    // 65 - 60 = 5, but 45 is already committed. Clamp to 45, not 5.
    expect(netOnlineRow(online, 60).allocatedSlots).toBe(45);
  });

  it('returns the row untouched when there are no children', () => {
    const online = row({ allocatedSlots: 65 });
    expect(netOnlineRow(online, 0)).toBe(online);
  });
});

import { sumPartnerFundedChildren, netPartnerPoolRow, findPartnerPoolRow } from './tree.js';

describe('sumPartnerFundedChildren', () => {
  it('counts only children funded from the partner pool', () => {
    const rows = [
      row({ id: 4, channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 }),
      row({
        id: 5,
        channel: 'agency',
        ownerId: 9,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: 8,
      }),
      row({ id: 2, channel: 'agency', ownerId: 7, allocationType: 'guaranteed', allocatedSlots: 10 }),
    ];
    expect(sumPartnerFundedChildren(rows)).toBe(8);
  });
});

describe('netPartnerPoolRow', () => {
  it('reduces the pool by its own funded children', () => {
    const pool = row({ channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 });
    expect(netPartnerPoolRow(pool, 8).allocatedSlots).toBe(12);
  });

  it('clamps to committed capacity', () => {
    const pool = row({
      channel: 'partner_pool',
      allocationType: 'flexible',
      allocatedSlots: 20,
      soldSlots: 15,
    });
    expect(netPartnerPoolRow(pool, 18).allocatedSlots).toBe(15);
  });
});

describe('findPartnerPoolRow', () => {
  it('finds the pool row', () => {
    const pool = row({ id: 4, channel: 'partner_pool', allocationType: 'flexible' });
    expect(findPartnerPoolRow([row({ id: 1 }), pool])?.id).toBe(4);
  });

  it('returns undefined when the config has no pool', () => {
    expect(findPartnerPoolRow([row({ id: 1 })])).toBeUndefined();
  });
});
