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

export interface Confirmation {
  /** True when every row under the token was already confirmed (idempotent replay). */
  alreadyConfirmed: boolean;
  splits: Split[];
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

export type DemoRole = 'administrator' | 'operator' | 'partner';
export interface DemoIdentity { role: DemoRole; label: string; ownerId: number | null }

export interface ConfigurationRowInput {
  channel: Channel;
  allocationType: AllocationType;
  fundingSource: FundingSource;
  allocatedSlots: number;
  ownerName: string | null;
}

export interface ConfigurationInput {
  vesselName: string;
  cabinName: string;
  departurePort: string;
  departsAt: string;
  bookingCutoffAt: string;
  capacity: number;
  rows: ConfigurationRowInput[];
}

export interface ConfigurationPreview {
  input: ConfigurationInput;
  violations: Violation[];
  directAllocated: number;
  unallocated: number;
  rows: (ConfigurationRowInput & { rawAvailable: number; nettedAvailable: number })[];
}

export interface ConfigurationRequest {
  id: number;
  status: 'submitted' | 'approved' | 'rejected';
  proposed: ConfigurationInput;
  submittedBy: string;
  reviewedBy: string | null;
  reviewReason: string | null;
  configId: number | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface PartnerInventory {
  allocationId: number;
  configId: number;
  channel: Channel;
  allocationType: AllocationType;
  allocatedSlots: number;
  heldSlots: number;
  soldSlots: number;
  availableSlots: number;
  ownerName: string;
  vesselName: string;
  departurePort: string;
  departsAt: string;
}

export interface PartnerActivity {
  id: number;
  configId: number;
  eventType: string;
  quantity: number;
  reason: string | null;
  createdAt: string;
}

export interface InventoryReport {
  configId: number;
  physicalCapacity: number;
  sellableNow: number;
  heldSeats: number;
  holdsDueSoon: number;
  confirmedSales: number;
  releasedSeats: number;
  cutoffReturnedSeats: number;
  preventedOversellAttempts: number;
  channels: {
    channel: Channel;
    ownerName: string | null;
    allocationType: AllocationType;
    allocatedSeats: number;
    sellableNow: number;
    heldSeats: number;
    soldSeats: number;
  }[];
}

export interface CrmDelivery {
  id: number;
  eventKey: string;
  eventType: string;
  status: 'pending' | 'sending' | 'delivered' | 'failed';
  attempts: number;
  lastHttpStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
}
