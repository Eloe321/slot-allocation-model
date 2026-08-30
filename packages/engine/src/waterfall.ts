import type { AllocationRow, RequesterIdentity } from './types.js';

function isChild(row: AllocationRow): boolean {
  return row.allocationType === 'flexible' || row.allocationType === 'guaranteed';
}

/** Guaranteed rows are consumed before flexible ones; ties break on id for determinism. */
function byPreference(a: AllocationRow, b: AllocationRow): number {
  const rank = (r: AllocationRow) => (r.allocationType === 'guaranteed' ? 0 : 1);
  return rank(a) - rank(b) || a.id - b.id;
}

/**
 * The requester's own row, if any.
 *
 * For owned channels the match is on `(channel, ownerId, funding)` together.
 * Funding matters because a managed owner's entitlement lives on a
 * partner-funded row and an ordinary owner's on an online-funded one; matching
 * on channel and owner alone would hand a requester the wrong budget.
 */
export function selectPrimary(
  rows: AllocationRow[],
  identity: RequesterIdentity,
): AllocationRow | undefined {
  const matches = rows.filter((r) => {
    switch (identity.kind) {
      case 'counter':
        return r.channel === 'counter' && r.ownerId === null && r.allocationType === 'direct';
      case 'online':
        return r.channel === 'online' && r.ownerId === null && r.allocationType === 'direct';
      case 'marketplace':
        return r.channel === 'marketplace' && r.ownerId === null && r.allocationType === 'direct';
      case 'owner':
        return (
          r.channel === identity.channel &&
          r.ownerId === identity.ownerId &&
          isChild(r) &&
          (identity.managed
            ? r.fundingSource === 'partner_pool'
            : r.fundingSource !== 'partner_pool')
        );
    }
  });
  return matches.sort(byPreference)[0];
}
