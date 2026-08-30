import { describe, it, expect } from 'vitest';
import { row } from './test-support.js';
import { rawAvailable } from './tree.js';

describe('rawAvailable', () => {
  it('subtracts sold and held from allocated', () => {
    expect(rawAvailable(row({ allocatedSlots: 10, soldSlots: 3, heldSlots: 2 }))).toBe(5);
  });

  it('never returns a negative number', () => {
    expect(rawAvailable(row({ allocatedSlots: 5, soldSlots: 4, heldSlots: 4 }))).toBe(0);
  });
});

import { sumOnlineFundedChildren, netAgainstChildren } from './tree.js';

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

describe('netAgainstChildren, on the online parent', () => {
  it('reduces effective allocation by the children carved out of it', () => {
    const online = row({ allocatedSlots: 65 });
    expect(netAgainstChildren(online, 35).allocatedSlots).toBe(30);
  });

  it('never nets below what the parent has already committed', () => {
    const online = row({ allocatedSlots: 65, soldSlots: 40, heldSlots: 5 });
    // 65 - 60 = 5, but 45 is already committed. Clamp to 45, not 5.
    expect(netAgainstChildren(online, 60).allocatedSlots).toBe(45);
  });

  it('returns the row untouched when there are no children', () => {
    const online = row({ allocatedSlots: 65 });
    expect(netAgainstChildren(online, 0)).toBe(online);
  });
});

import { sumPartnerFundedChildren, findPartnerPoolRow } from './tree.js';

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

describe('netAgainstChildren, on the partner pool', () => {
  it('reduces the pool by its own funded children', () => {
    const pool = row({ channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 });
    expect(netAgainstChildren(pool, 8).allocatedSlots).toBe(12);
  });

  it('clamps to committed capacity', () => {
    const pool = row({
      channel: 'partner_pool',
      allocationType: 'flexible',
      allocatedSlots: 20,
      soldSlots: 15,
    });
    expect(netAgainstChildren(pool, 18).allocatedSlots).toBe(15);
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

import { collapseToCommitted, applyOwnerAvailability } from './tree.js';

describe('collapseToCommitted', () => {
  it('reduces allocation to exactly what is sold and held', () => {
    const r = row({ allocatedSlots: 10, soldSlots: 3, heldSlots: 2 });
    const collapsed = collapseToCommitted(r);
    expect(collapsed.allocatedSlots).toBe(5);
    expect(rawAvailable(collapsed)).toBe(0);
  });
});

describe('applyOwnerAvailability', () => {
  const hidden = row({
    id: 2,
    channel: 'agency',
    ownerId: 7,
    allocationType: 'guaranteed',
    allocatedSlots: 10,
    soldSlots: 4,
    ownerIsHidden: true,
  });

  it('collapses a hidden row for an unrelated requester', () => {
    const [result] = applyOwnerAvailability([hidden]);
    expect(result?.allocatedSlots).toBe(4);
  });

  it('collapses a hidden row even for its own owner', () => {
    // Netting is identity-free: the masked owner sees the same collapsed tree
    // every other channel sees, so the freed seats are only ever offered once.
    const [result] = applyOwnerAvailability([hidden]);
    expect(result?.allocatedSlots).toBe(4);
  });

  it('collapses a hidden row belonging to a different owner', () => {
    const [result] = applyOwnerAvailability([hidden]);
    expect(result?.allocatedSlots).toBe(4);
  });

  it('leaves visible rows untouched', () => {
    const visible = row({ id: 3, channel: 'agency', ownerId: 8, allocationType: 'flexible', allocatedSlots: 6 });
    const [result] = applyOwnerAvailability([visible]);
    expect(result).toBe(visible);
  });
});
