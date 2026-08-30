export type Channel =
  | 'counter' | 'online' | 'marketplace' | 'partner_pool' | 'agency' | 'reseller';
export type AllocationType = 'direct' | 'flexible' | 'guaranteed';
export type FundingSource = 'online' | 'partner_pool';
export type WaterfallStep = 'primary' | 'partner_pool' | 'online_remainder';

export interface TreeRow {
  id: number;
  channel: Channel;
  ownerId: number | null;
  ownerName: string | null;
  allocationType: AllocationType;
  fundingSource: FundingSource;
  allocatedSlots: number;
  soldSlots: number;
  heldSlots: number;
  ownerIsHidden: boolean;
  rawAvailable: number;
  nettedAvailable: number;
}

export interface Violation { code: string; rowId: number | null; detail: string }

export interface Tree {
  configId: number;
  cabinCapacity: number;
  violations: Violation[];
  rows: TreeRow[];
}

export interface Candidate { row: TreeRow; step: WaterfallStep }
export interface Skipped { step: WaterfallStep; rowId: number | null; code: string; reason: string }

export interface Trace {
  candidates: Candidate[];
  skipped: Skipped[];
  freeForAll: boolean;
  /** Present only on the preview endpoint; a reserve response omits it. */
  available?: number;
}

export interface Split { rowId: number; step: WaterfallStep; quantity: number }

export interface Reservation {
  token: string;
  expiresAt: string;
  splits: Split[];
  trace: Trace;
}

export interface Shortfall {
  error: 'insufficient_capacity';
  requested: number;
  available: number;
  shortfall: number;
}

export interface LedgerEntry {
  id: number;
  allocationId: number | null;
  eventType: string;
  quantity: number;
  actor: string;
  reason: string | null;
  token: string | null;
  createdAt: string;
}

export interface Scenario {
  key: string;
  title: string;
  teaches: string;
  cabinCapacity: number;
  configId: string | null;
}

export interface Identity {
  channel: Channel;
  ownerId?: number;
  managed?: boolean;
}
