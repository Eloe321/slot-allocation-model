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
