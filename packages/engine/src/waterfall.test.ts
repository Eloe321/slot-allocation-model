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

import { selectCandidates } from './waterfall.js';

const tree: AllocationRow[] = [
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

describe('selectCandidates', () => {
  it('nets the online parent against its children', () => {
    const trace = selectCandidates(tree, { kind: 'online' });
    // 65 allocated, minus agency#7 (10) and the pool (20) = 35 free.
    expect(trace.candidates).toHaveLength(1);
    expect(trace.candidates[0]?.row.allocatedSlots).toBe(35);
    expect(trace.candidates[0]?.step).toBe('online_remainder');
  });

  it('gives counter its own row and nothing else', () => {
    const trace = selectCandidates(tree, { kind: 'counter' });
    expect(trace.candidates.map((c) => c.row.id)).toEqual([1]);
    expect(trace.skipped.some((s) => s.reason.includes('siloed'))).toBe(true);
  });

  it('spills an ordinary owner into the netted online remainder', () => {
    const trace = selectCandidates(tree, {
      kind: 'owner',
      channel: 'agency',
      ownerId: 7,
      managed: false,
    });
    expect(trace.candidates.map((c) => c.row.id)).toEqual([4, 3]);
    expect(trace.candidates.map((c) => c.step)).toEqual(['primary', 'online_remainder']);
  });

  it('does not offer the partner pool to an ordinary owner', () => {
    const trace = selectCandidates(tree, {
      kind: 'owner',
      channel: 'agency',
      ownerId: 7,
      managed: false,
    });
    expect(trace.candidates.some((c) => c.step === 'partner_pool')).toBe(false);
    expect(trace.skipped.some((s) => s.step === 'partner_pool')).toBe(true);
  });

  it('walks own row, pool, then online for a managed owner', () => {
    const trace = selectCandidates(tree, {
      kind: 'owner',
      channel: 'agency',
      ownerId: 9,
      managed: true,
    });
    expect(trace.candidates.map((c) => c.row.id)).toEqual([6, 5, 3]);
    expect(trace.candidates.map((c) => c.step)).toEqual([
      'primary',
      'partner_pool',
      'online_remainder',
    ]);
  });

  it('nets the partner pool against its own funded children', () => {
    const trace = selectCandidates(tree, {
      kind: 'owner',
      channel: 'agency',
      ownerId: 9,
      managed: true,
    });
    const pool = trace.candidates.find((c) => c.step === 'partner_pool');
    // 20 allocated, minus agency#9's 8 = 12.
    expect(pool?.row.allocatedSlots).toBe(12);
  });

  it('gives marketplace its own row then online, never the pool', () => {
    const trace = selectCandidates(tree, { kind: 'marketplace' });
    expect(trace.candidates.map((c) => c.row.id)).toEqual([2, 3]);
    expect(trace.candidates.some((c) => c.step === 'partner_pool')).toBe(false);
  });

  it('treats a lone online direct row as free-for-all', () => {
    const soloConfig = [row({ id: 1, channel: 'online', allocatedSlots: 100 })];
    const trace = selectCandidates(soloConfig, { kind: 'counter' });
    expect(trace.freeForAll).toBe(true);
    expect(trace.candidates.map((c) => c.row.id)).toEqual([1]);
  });
});
