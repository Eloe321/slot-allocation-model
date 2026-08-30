import {
  findPartnerPoolRow,
  findOnlineDirectRow,
  isChild,
  sumOnlineFundedChildren,
  sumPartnerFundedChildren,
} from './tree.js';
import type { AllocationRow } from './types.js';

export type ViolationCode =
  | 'row_overcommitted'
  | 'direct_exceeds_capacity'
  | 'online_children_exceed_parent'
  | 'partner_children_exceed_pool'
  | 'online_child_without_parent'
  | 'partner_child_without_pool'
  | 'duplicate_online_parent'
  | 'duplicate_partner_pool'
  | 'duplicate_owner_row';

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

  violations.push(...checkStructure(rows));

  return violations;
}

/**
 * Rules about which rows may exist at all, independent of any arithmetic.
 *
 * A child with no parent row belongs to no physical partition: its seats are
 * conjured from nothing and are offered on top of, rather than out of, the
 * cabin. Duplicate parent rows make "the online row" ambiguous, so netting may
 * be applied to one of them while another is offered un-netted. Duplicate owner
 * rows are all netted out of the parent but only the first is ever offered back,
 * stranding the remainder where no channel can reach them.
 */
function checkStructure(rows: AllocationRow[]): Violation[] {
  const violations: Violation[] = [];

  const onlineChildren = rows.filter((r) => isChild(r) && r.fundingSource !== 'partner_pool');
  if (onlineChildren.length > 0 && !findOnlineDirectRow(rows)) {
    violations.push({
      code: 'online_child_without_parent',
      rowId: null,
      detail: `${onlineChildren.length} online-funded child row(s) exist with no online parent row`,
    });
  }

  const partnerChildren = rows.filter((r) => isChild(r) && r.fundingSource === 'partner_pool');
  if (partnerChildren.length > 0 && !findPartnerPoolRow(rows)) {
    violations.push({
      code: 'partner_child_without_pool',
      rowId: null,
      detail: `${partnerChildren.length} partner-funded child row(s) exist with no partner pool row`,
    });
  }

  const onlineParents = rows.filter(
    (r) => r.channel === 'online' && r.ownerId === null && r.allocationType === 'direct',
  );
  if (onlineParents.length > 1) {
    violations.push({
      code: 'duplicate_online_parent',
      rowId: null,
      detail: `${onlineParents.length} unowned online direct rows; expected at most one`,
    });
  }

  const pools = rows.filter((r) => r.channel === 'partner_pool');
  if (pools.length > 1) {
    violations.push({
      code: 'duplicate_partner_pool',
      rowId: null,
      detail: `${pools.length} partner pool rows; expected at most one`,
    });
  }

  // `(channel, ownerId, fundingSource)` is exactly the key `selectPrimary`
  // resolves an owner with, so anything sharing it is unaddressable.
  const owned = new Map<string, AllocationRow[]>();
  for (const r of rows) {
    if (r.ownerId === null) continue;
    const key = `${r.channel}|${r.ownerId}|${r.fundingSource}`;
    const group = owned.get(key);
    if (group) group.push(r);
    else owned.set(key, [r]);
  }
  for (const group of owned.values()) {
    const first = group[0];
    if (group.length > 1 && first) {
      violations.push({
        code: 'duplicate_owner_row',
        rowId: null,
        detail: `duplicate rows for owner ${first.ownerId} on channel ${first.channel} funded from ${first.fundingSource}`,
      });
    }
  }

  return violations;
}
