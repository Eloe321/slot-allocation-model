import type { AllocationRow, RequesterIdentity } from './types.js';
import {
  applyOwnerAvailability,
  findOnlineDirectRow,
  findPartnerPoolRow,
  isChild,
  netAgainstChildren,
  rawAvailable,
  sumOnlineFundedChildren,
  sumPartnerFundedChildren,
} from './tree.js';

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

export type WaterfallStep = 'primary' | 'partner_pool' | 'online_remainder';

export interface Candidate {
  row: AllocationRow;
  step: WaterfallStep;
}

export interface SkippedCandidate {
  step: WaterfallStep;
  rowId: number | null;
  reason: string;
}

export interface WaterfallTrace {
  identity: RequesterIdentity;
  candidates: Candidate[];
  skipped: SkippedCandidate[];
  /** True when the config is a single unowned online direct row. */
  freeForAll: boolean;
}

/**
 * Resolve an identity to an ordered list of rows it may draw from.
 *
 * Order is always: own row, then the partner pool when eligible, then the netted
 * online remainder. `counter` is deliberately siloed and never spills.
 */
export function selectCandidates(
  rows: AllocationRow[],
  identity: RequesterIdentity,
): WaterfallTrace {
  const effective = applyOwnerAvailability(rows);
  const candidates: Candidate[] = [];
  const skipped: SkippedCandidate[] = [];

  const rawOnline = findOnlineDirectRow(effective);
  const online = rawOnline
    ? netAgainstChildren(rawOnline, sumOnlineFundedChildren(effective))
    : undefined;

  const rawPool = findPartnerPoolRow(effective);
  const pool = rawPool
    ? netAgainstChildren(rawPool, sumPartnerFundedChildren(effective))
    : undefined;

  const freeForAll = effective.length === 1 && online !== undefined && online.id === effective[0]?.id;

  if (freeForAll && online) {
    return {
      identity,
      candidates: [{ row: online, step: 'online_remainder' }],
      skipped: [],
      freeForAll: true,
    };
  }

  const rawPrimary = selectPrimary(effective, identity);
  // When the requester IS the online parent, use the netted view so its
  // availability agrees with the spill computation below.
  const primary = rawPrimary && online && rawPrimary.id === online.id ? online : rawPrimary;

  if (primary) {
    candidates.push({
      row: primary,
      step: identity.kind === 'online' ? 'online_remainder' : 'primary',
    });
  } else if (identity.kind === 'owner') {
    skipped.push({ step: 'primary', rowId: null, reason: 'owner has no dedicated row on this config' });
  }

  if (identity.kind === 'counter') {
    skipped.push({
      step: 'online_remainder',
      rowId: online?.id ?? null,
      reason: 'counter is siloed and never falls back to another pool',
    });
    return { identity, candidates, skipped, freeForAll };
  }

  const mayDrawPool = identity.kind === 'owner' && identity.managed;
  if (pool && pool.id !== primary?.id) {
    if (mayDrawPool) {
      candidates.push({ row: pool, step: 'partner_pool' });
    } else {
      skipped.push({
        step: 'partner_pool',
        rowId: pool.id,
        reason:
          identity.kind === 'owner'
            ? 'owner is not managed, so it is funded from online rather than the pool'
            : 'only managed owners may draw the partner pool',
      });
    }
  }

  if (online && online.id !== primary?.id) {
    candidates.push({ row: online, step: 'online_remainder' });
  }

  return { identity, candidates, skipped, freeForAll };
}

/** Total seats currently available across a trace's candidates. */
export function sumAvailable(trace: WaterfallTrace): number {
  return trace.candidates.reduce((total, c) => total + rawAvailable(c.row), 0);
}
