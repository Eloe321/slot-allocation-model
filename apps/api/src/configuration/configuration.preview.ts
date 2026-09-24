import {
  checkInvariants,
  nettedAvailable,
  rawAvailable,
  type AllocationRow,
  type AllocationType,
  type Channel,
  type FundingSource,
  type Violation,
} from '@slot/engine';

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

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function label(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 100) {
    throw new Error(`${name} must contain 1 to 100 characters`);
  }
  return value.trim();
}

function date(value: unknown, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be a valid date and time`);
  }
  return new Date(value).toISOString();
}

function slots(value: unknown, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > 1_000_000) {
    throw new Error(`${name} must be an integer from ${minimum} to 1000000`);
  }
  return value as number;
}

const channels: Channel[] = ['counter', 'online', 'marketplace', 'partner_pool', 'agency', 'reseller'];
const allocationTypes: AllocationType[] = ['direct', 'flexible', 'guaranteed'];
const fundingSources: FundingSource[] = ['online', 'partner_pool'];

export function previewConfiguration(value: unknown): ConfigurationPreview {
  const data = record(value, 'configuration');
  const capacity = slots(data.capacity, 'capacity', 1);
  const departsAt = date(data.departsAt, 'departsAt');
  const bookingCutoffAt = date(data.bookingCutoffAt, 'bookingCutoffAt');
  if (bookingCutoffAt >= departsAt) {
    throw new Error('bookingCutoffAt must be before departsAt');
  }
  if (!Array.isArray(data.rows) || data.rows.length < 1 || data.rows.length > 30) {
    throw new Error('rows must contain 1 to 30 allocations');
  }

  const rows: ConfigurationRowInput[] = data.rows.map((item: unknown, index: number) => {
    const row = record(item, `rows[${index}]`);
    if (!channels.includes(row.channel as Channel)) throw new Error(`rows[${index}].channel is invalid`);
    if (!allocationTypes.includes(row.allocationType as AllocationType)) {
      throw new Error(`rows[${index}].allocationType is invalid`);
    }
    const fundingSource = row.fundingSource ?? 'online';
    if (!fundingSources.includes(fundingSource as FundingSource)) {
      throw new Error(`rows[${index}].fundingSource is invalid`);
    }
    const channel = row.channel as Channel;
    const allocationType = row.allocationType as AllocationType;
    const owned = channel === 'agency' || channel === 'reseller';
    const ownerName = owned ? label(row.ownerName, `rows[${index}].ownerName`) : null;
    if (!owned && row.ownerName != null) throw new Error(`rows[${index}].ownerName is only for partners`);
    if (allocationType === 'direct' && (!['counter', 'online', 'marketplace'].includes(channel) || fundingSource !== 'online')) {
      throw new Error(`rows[${index}] direct allocations must be top-level channels`);
    }
    if (allocationType !== 'direct' && !['agency', 'reseller', 'partner_pool'].includes(channel)) {
      throw new Error(`rows[${index}] child allocations must be partner channels or the partner pool`);
    }
    if (channel === 'partner_pool' && fundingSource !== 'online') {
      throw new Error(`rows[${index}] partner_pool must be funded by online`);
    }
    return {
      channel,
      allocationType,
      fundingSource: fundingSource as FundingSource,
      allocatedSlots: slots(row.allocatedSlots, `rows[${index}].allocatedSlots`, 0),
      ownerName,
    };
  });

  const ownerIds = new Map<string, number>();
  const engineRows: AllocationRow[] = rows.map((row, index) => {
    const key = row.ownerName?.toLocaleLowerCase() ?? null;
    if (key && !ownerIds.has(key)) ownerIds.set(key, ownerIds.size + 1);
    return {
      id: index + 1,
      channel: row.channel,
      allocationType: row.allocationType,
      fundingSource: row.fundingSource,
      allocatedSlots: row.allocatedSlots,
      soldSlots: 0,
      heldSlots: 0,
      ownerId: key ? ownerIds.get(key)! : null,
      ownerIsHidden: false,
    };
  });
  const directAllocated = rows
    .filter((row) => row.allocationType === 'direct')
    .reduce((sum, row) => sum + row.allocatedSlots, 0);
  return {
    input: {
      vesselName: label(data.vesselName, 'vesselName'),
      cabinName: label(data.cabinName, 'cabinName'),
      departurePort: label(data.departurePort, 'departurePort'),
      departsAt,
      bookingCutoffAt,
      capacity,
      rows,
    },
    violations: checkInvariants(engineRows, capacity),
    directAllocated,
    unallocated: Math.max(0, capacity - directAllocated),
    rows: rows.map((row, index) => ({
      ...row,
      rawAvailable: rawAvailable(engineRows[index]!),
      nettedAvailable: nettedAvailable(engineRows[index]!, engineRows),
    })),
  };
}
