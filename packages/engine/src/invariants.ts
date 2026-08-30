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

  const onlineParent = findOnlineDirectRow(rows);
  const onlineChildren = sumOnlineFundedChildren(rows);
  if (onlineParent && onlineChildren > onlineParent.allocatedSlots) {
    violations.push({
      code: 'online_children_exceed_parent',
      rowId: null,
      detail: `online-funded children total ${onlineChildren}, online parent allocates ${onlineParent.allocatedSlots}`,
    });
  }

  const pool = findPartnerPoolRow(rows);
  const partnerChildren = sumPartnerFundedChildren(rows);
  if (pool && partnerChildren > pool.allocatedSlots) {
    violations.push({
      code: 'partner_children_exceed_pool',
      rowId: null,
      detail: `partner-funded children total ${partnerChildren}, partner pool allocates ${pool.allocatedSlots}`,
    });
  }

  return violations;
}
