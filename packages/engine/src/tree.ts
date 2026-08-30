import type { AllocationRow } from './types.js';

/** Free seats on a single row, before any parent netting. */
export function rawAvailable(row: AllocationRow): number {
  return Math.max(0, row.allocatedSlots - row.soldSlots - row.heldSlots);
}

export function isChild(row: AllocationRow): boolean {
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

/** Seats carved out of the partner pool by its own funded children. */
export function sumPartnerFundedChildren(rows: AllocationRow[]): number {
  return rows.reduce(
    (total, r) => (r.fundingSource === 'partner_pool' ? total + r.allocatedSlots : total),
    0,
  );
}

/** The partner pool netted against the children carved out of it. */
export function netPartnerPoolRow(
  poolRow: AllocationRow,
  childrenAllocated: number,
): AllocationRow {
  if (childrenAllocated <= 0) return poolRow;
  const committed = poolRow.soldSlots + poolRow.heldSlots;
  const netted = Math.max(committed, poolRow.allocatedSlots - childrenAllocated);
  return { ...poolRow, allocatedSlots: netted };
}

/** The shared pool row, if this config has one. */
export function findPartnerPoolRow(rows: AllocationRow[]): AllocationRow | undefined {
  return rows.find((r) => r.channel === 'partner_pool');
}

/** The unowned direct online row: the parent every online-funded child draws from. */
export function findOnlineDirectRow(rows: AllocationRow[]): AllocationRow | undefined {
  return rows.find(
    (r) => r.channel === 'online' && r.ownerId === null && r.allocationType === 'direct',
  );
}

/** A view of a row with no free entitlement, retaining its committed seats. */
export function collapseToCommitted(row: AllocationRow): AllocationRow {
  return { ...row, allocatedSlots: row.soldSlots + row.heldSlots };
}

function isOwnedChannel(row: AllocationRow): boolean {
  return row.channel === 'agency' || row.channel === 'reseller';
}

/**
 * Collapse every hidden-owner child, for every requester — including the masked
 * owner itself.
 *
 * A hidden owner keeps no free seats, but its sold and held seats must remain
 * carved out of the parent — restoring them would let the parent resell capacity
 * that is already committed.
 *
 * The collapse is deliberately identity-free. Exempting the requester's own row
 * would make the netted tree differ per requester: every other channel would see
 * the child collapsed and the parent hand its free seats back, while the masked
 * owner went on holding those same seats. Each view is self-consistent, but
 * together they sell the same physical seat twice. Netting must not depend on
 * who is asking — one tree, one answer, for everyone.
 */
export function applyOwnerAvailability(rows: AllocationRow[]): AllocationRow[] {
  return rows.map((r) =>
    isOwnedChannel(r) && r.ownerIsHidden && r.ownerId !== null ? collapseToCommitted(r) : r,
  );
}
