import {
  findPartnerPoolRow,
  findOnlineDirectRow,
  sumOnlineFundedChildren,
  sumPartnerFundedChildren,
} from './tree.js';
import type { AllocationRow } from './types.js';

export type ViolationCode =
  | 'row_overcommitted'
  | 'direct_exceeds_capacity'
  | 'online_children_exceed_parent'
  | 'partner_children_exceed_pool';

export interface Violation {
  code: ViolationCode;
  rowId: number | null;
  detail: string;
}

/**
 * Every structural rule the tree must satisfy.
 *
 * Note that this deliberately never sums all rows to check total capacity:
 * parents and children overlap by design, so a naive sum would report a
 * violation on a perfectly valid tree.
 */
export function checkInvariants(rows: AllocationRow[], cabinCapacity: number): Violation[] {
  const violations: Violation[] = [];

  for (const r of rows) {
    if (r.soldSlots + r.heldSlots > r.allocatedSlots) {
      violations.push({
        code: 'row_overcommitted',
        rowId: r.id,
        detail: `sold ${r.soldSlots} + held ${r.heldSlots} exceeds allocated ${r.allocatedSlots}`,
      });
    }
  }

  const directTotal = rows
    .filter((r) => r.allocationType === 'direct')
    .reduce((total, r) => total + r.allocatedSlots, 0);
  if (directTotal > cabinCapacity) {
    violations.push({
      code: 'direct_exceeds_capacity',
      rowId: null,
      detail: `direct allocations total ${directTotal}, cabin capacity is ${cabinCapacity}`,
    });
  }

  // A parent's own sold and held seats draw on the same physical partition its
  // children were carved out of, so they belong on the same side of the ceiling.
  // Comparing children against the parent's allocation alone lets an online row
  // that has already sold 60 of 100 still advertise a 50-seat child as valid.
  const onlineParent = findOnlineDirectRow(rows);
  const onlineChildren = sumOnlineFundedChildren(rows);
  if (onlineParent) {
    const parentCommitted = onlineParent.soldSlots + onlineParent.heldSlots;
    if (onlineChildren + parentCommitted > onlineParent.allocatedSlots) {
      violations.push({
        code: 'online_children_exceed_parent',
        rowId: null,
        detail: `online-funded children total ${onlineChildren} plus parent committed ${parentCommitted} exceed online parent allocation ${onlineParent.allocatedSlots}`,
      });
    }
  }

  const pool = findPartnerPoolRow(rows);
  const partnerChildren = sumPartnerFundedChildren(rows);
  if (pool) {
    const poolCommitted = pool.soldSlots + pool.heldSlots;
    if (partnerChildren + poolCommitted > pool.allocatedSlots) {
      violations.push({
        code: 'partner_children_exceed_pool',
        rowId: null,
        detail: `partner-funded children total ${partnerChildren} plus pool committed ${poolCommitted} exceed partner pool allocation ${pool.allocatedSlots}`,
      });
    }
  }

  return violations;
}
