/** Sales channel. `partner_pool` is a shared pool for managed owners. */
export type Channel =
  | 'counter'
  | 'online'
  | 'marketplace'
  | 'partner_pool'
  | 'agency'
  | 'reseller';

/**
 * `direct` rows are top-level physical partitions of cabin capacity.
 * `flexible` children are reclaimed at cutoff; `guaranteed` children survive it.
 */
export type AllocationType = 'direct' | 'flexible' | 'guaranteed';

/** Which parent pool this row was carved out of. This is what makes the tree a tree. */
export type FundingSource = 'online' | 'partner_pool';

export interface AllocationRow {
  id: number;
  channel: Channel;
  /** Meaningful only for `agency` and `reseller`; null on every unowned row. */
  ownerId: number | null;
  allocationType: AllocationType;
  fundingSource: FundingSource;
  allocatedSlots: number;
  soldSlots: number;
  heldSlots: number;
  /**
   * True when this row's owner is deleted or masked. Drives the collapse rule in
   * `tree.ts` only. It is NOT the same as a requester being `managed`.
   */
  ownerIsHidden: boolean;
}

/**
 * Who is asking for seats. The `owner` variant requires a non-null `ownerId`, so
 * an unresolved owner is unrepresentable here by construction — the runtime
 * boundary that parses untrusted input is where it must throw.
 */
export type RequesterIdentity =
  | { kind: 'counter' }
  | { kind: 'online' }
  | { kind: 'marketplace' }
  | {
      kind: 'owner';
      channel: 'agency' | 'reseller';
      ownerId: number;
      /** Managed owners are funded from `partner_pool` and may draw it. */
      managed: boolean;
    };
