import { describe, it, expect } from 'vitest';
import { selectPrimary } from './waterfall.js';
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

describe('selectPrimary', () => {
  it('matches the counter direct row', () => {
    const rows = [row({ id: 1 }), row({ id: 2, channel: 'counter' })];
    expect(selectPrimary(rows, { kind: 'counter' })?.id).toBe(2);
  });

  it('matches the unowned direct online row', () => {
    const rows = [row({ id: 1 }), row({ id: 2, channel: 'counter' })];
    expect(selectPrimary(rows, { kind: 'online' })?.id).toBe(1);
  });

  it('matches on channel and owner together', () => {
    const rows = [
      row({ id: 2, channel: 'agency', ownerId: 7, allocationType: 'flexible' }),
      row({ id: 3, channel: 'reseller', ownerId: 7, allocationType: 'flexible' }),
    ];
    const primary = selectPrimary(rows, {
      kind: 'owner',
      channel: 'reseller',
      ownerId: 7,
      managed: false,
    });
    expect(primary?.id).toBe(3);
  });

  it('gives an ordinary owner an online-funded row, not a partner-funded one', () => {
    const rows = [
      row({ id: 2, channel: 'agency', ownerId: 7, allocationType: 'flexible', fundingSource: 'partner_pool' }),
      row({ id: 3, channel: 'agency', ownerId: 7, allocationType: 'flexible', fundingSource: 'online' }),
    ];
    const primary = selectPrimary(rows, { kind: 'owner', channel: 'agency', ownerId: 7, managed: false });
    expect(primary?.id).toBe(3);
  });

  it('gives a managed owner the partner-funded row', () => {
    const rows = [
      row({ id: 2, channel: 'agency', ownerId: 7, allocationType: 'flexible', fundingSource: 'partner_pool' }),
      row({ id: 3, channel: 'agency', ownerId: 7, allocationType: 'flexible', fundingSource: 'online' }),
    ];
    const primary = selectPrimary(rows, { kind: 'owner', channel: 'agency', ownerId: 7, managed: true });
    expect(primary?.id).toBe(2);
  });

  it('prefers guaranteed over flexible when both match', () => {
    const rows = [
      row({ id: 2, channel: 'agency', ownerId: 7, allocationType: 'flexible' }),
      row({ id: 3, channel: 'agency', ownerId: 7, allocationType: 'guaranteed' }),
    ];
    const primary = selectPrimary(rows, { kind: 'owner', channel: 'agency', ownerId: 7, managed: false });
    expect(primary?.id).toBe(3);
  });

  it('returns undefined when the owner has no row', () => {
    const rows = [row({ id: 1 })];
    expect(
      selectPrimary(rows, { kind: 'owner', channel: 'agency', ownerId: 7, managed: false }),
    ).toBeUndefined();
  });
});

export { row };
