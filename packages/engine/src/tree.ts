import type { AllocationRow } from './types.js';

/** Free seats on a single row, before any parent netting. */
export function rawAvailable(row: AllocationRow): number {
  return Math.max(0, row.allocatedSlots - row.soldSlots - row.heldSlots);
}

function isChild(row: AllocationRow): boolean {
  return row.allocationType === 'flexible' || row.allocationType === 'guaranteed';
}

/**
 * Seats already carved out of the online parent. Partner-funded children are
 * excluded because they draw the partner pool, not the online budget.
 */
export function sumOnlineFundedChildren(rows: AllocationRow[]): number {
  return rows.reduce(
    (total, r) =>
      isChild(r) && r.fundingSource !== 'partner_pool' ? total + r.allocatedSlots : total,
    0,
  );
}

/**
 * A view of the online parent whose effective allocation excludes its children.
 *
 * The clamp to `sold + held` is load-bearing: an administrator enlarging a child
 * beyond what the parent already committed would otherwise drive effective
 * allocation negative and make the row report nonsense instead of zero.
 */
export function netOnlineRow(onlineRow: AllocationRow, childrenAllocated: number): AllocationRow {
  if (childrenAllocated <= 0) return onlineRow;
  const committed = onlineRow.soldSlots + onlineRow.heldSlots;
  const netted = Math.max(committed, onlineRow.allocatedSlots - childrenAllocated);
  return { ...onlineRow, allocatedSlots: netted };
}
