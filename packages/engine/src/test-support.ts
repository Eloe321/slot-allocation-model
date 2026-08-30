import type { AllocationRow } from './types.js';

/**
 * A neutral allocation row for tests: an empty, unowned, direct online parent.
 *
 * Every field is spelled out so a test's overrides are the whole of what makes
 * that test's case interesting. Shared rather than copied per file so that
 * adding a field to `AllocationRow` breaks in exactly one place.
 */
export function row(over: Partial<AllocationRow> = {}): AllocationRow {
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
