import { describe, it, expect } from 'vitest';
import { planConsumption } from './plan.js';
import { selectCandidates } from './waterfall.js';
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

const tree: AllocationRow[] = [
  row({ id: 3, channel: 'online', allocatedSlots: 65 }),
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

const managed = { kind: 'owner', channel: 'agency', ownerId: 9, managed: true } as const;

describe('planConsumption', () => {
  it('takes everything from the first candidate when it fits', () => {
    const result = planConsumption(selectCandidates(tree, managed), 5);
    expect(result).toEqual({ ok: true, splits: [{ rowId: 6, step: 'primary', quantity: 5 }] });
  });

  it('splits across candidates in order when the first is not enough', () => {
    const result = planConsumption(selectCandidates(tree, managed), 25);
    expect(result).toEqual({
      ok: true,
      splits: [
        { rowId: 6, step: 'primary', quantity: 8 },
        { rowId: 5, step: 'partner_pool', quantity: 12 },
        { rowId: 3, step: 'online_remainder', quantity: 5 },
      ],
    });
  });

  it('skips exhausted candidates rather than emitting zero-quantity splits', () => {
    const exhausted = tree.map((r) => (r.id === 6 ? { ...r, soldSlots: 8 } : r));
    const result = planConsumption(selectCandidates(exhausted, managed), 3);
    expect(result).toEqual({
      ok: true,
      splits: [{ rowId: 5, step: 'partner_pool', quantity: 3 }],
    });
  });

  it('reports a typed shortfall instead of throwing', () => {
    const result = planConsumption(selectCandidates(tree, managed), 100);
    // 8 own + 12 netted pool + 45 netted online = 65.
    // (Only the pool row is an online-funded child here: agency#9 is
    // partner-funded, so it is netted from the pool, not from online.)
    expect(result).toEqual({ ok: false, requested: 100, available: 65, shortfall: 35 });
  });

  it('rejects a non-positive quantity', () => {
    expect(() => planConsumption(selectCandidates(tree, managed), 0)).toThrow(
      'quantity must be a positive integer',
    );
  });

  it('rejects a non-integer quantity', () => {
    expect(() => planConsumption(selectCandidates(tree, managed), 1.5)).toThrow(
      'quantity must be a positive integer',
    );
  });
});
