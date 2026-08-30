import type { AllocationRow } from './types.js';

/** Free seats on a single row, before any parent netting. */
export function rawAvailable(row: AllocationRow): number {
  return Math.max(0, row.allocatedSlots - row.soldSlots - row.heldSlots);
}
