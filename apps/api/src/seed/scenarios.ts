import type { Pool } from 'pg';

export interface ScenarioRow {
  channel: 'counter' | 'online' | 'marketplace' | 'partner_pool' | 'agency' | 'reseller';
  allocationType: 'direct' | 'flexible' | 'guaranteed';
  allocatedSlots: number;
  soldSlots?: number;
  heldSlots?: number;
  fundingSource?: 'online' | 'partner_pool';
  owner?: { name: string; hidden?: boolean };
}

export interface Scenario {
  key: string;
  title: string;
  /** The single rule this scenario is designed to demonstrate. */
  teaches: string;
  cabinCapacity: number;
  rows: ScenarioRow[];
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'double-count-trap',
    title: 'The double-count trap',
    teaches:
      'The online parent reads 65 free, but 35 is already carved out by its children. Only 30 is real.',
    cabinCapacity: 100,
    rows: [
      { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 },
      { channel: 'marketplace', allocationType: 'direct', allocatedSlots: 15 },
      { channel: 'online', allocationType: 'direct', allocatedSlots: 65 },
      {
        channel: 'agency',
        allocationType: 'guaranteed',
        allocatedSlots: 10,
        owner: { name: 'Northwind Travel' },
      },
      {
        channel: 'reseller',
        allocationType: 'flexible',
        allocatedSlots: 5,
        owner: { name: 'Seaway Resellers' },
      },
      { channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 },
    ],
  },
  {
    key: 'counter-siloed',
    title: 'Counter is siloed',
    teaches:
      'The counter never spills. A counter request for more than its own row fails even while online has seats.',
    cabinCapacity: 100,
    rows: [
      { channel: 'counter', allocationType: 'direct', allocatedSlots: 5 },
      { channel: 'online', allocationType: 'direct', allocatedSlots: 95 },
    ],
  },
  {
    key: 'three-way-split',
    title: 'One request, three rows',
    teaches:
      'A managed owner asking for 25 draws 8 from its own row, 12 from the netted pool, and 5 from online.',
    cabinCapacity: 100,
    rows: [
      { channel: 'online', allocationType: 'direct', allocatedSlots: 80 },
      { channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 },
      {
        channel: 'agency',
        allocationType: 'guaranteed',
        allocatedSlots: 8,
        fundingSource: 'partner_pool',
        owner: { name: 'Harbourline Managed' },
      },
      { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 },
    ],
  },
  {
    key: 'managed-draws-pool',
    title: 'Managed owners draw the pool, ordinary ones do not',
    teaches:
      'Two agencies with identical rows resolve to different candidate lists based solely on funding source.',
    cabinCapacity: 100,
    rows: [
      { channel: 'online', allocationType: 'direct', allocatedSlots: 80 },
      { channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 },
      {
        channel: 'agency',
        allocationType: 'guaranteed',
        allocatedSlots: 10,
        owner: { name: 'Ordinary Agency' },
      },
      {
        channel: 'agency',
        allocationType: 'guaranteed',
        allocatedSlots: 10,
        fundingSource: 'partner_pool',
        owner: { name: 'Managed Agency' },
      },
      { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 },
    ],
  },
  {
    key: 'hidden-owner-keeps-committed',
    title: 'A hidden owner keeps its committed seats',
    teaches:
      'The masked agency loses its 6 free seats to the parent but keeps the 4 it already sold, so those cannot be sold twice.',
    cabinCapacity: 100,
    rows: [
      { channel: 'online', allocationType: 'direct', allocatedSlots: 80 },
      {
        channel: 'agency',
        allocationType: 'flexible',
        allocatedSlots: 10,
        soldSlots: 4,
        owner: { name: 'Masked Agency', hidden: true },
      },
      { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 },
    ],
  },
  {
    key: 'free-for-all',
    title: 'Free-for-all',
    teaches:
      'With a single online direct row and no children, every channel draws from that one pool.',
    cabinCapacity: 100,
    rows: [{ channel: 'online', allocationType: 'direct', allocatedSlots: 100 }],
  },
];

export interface AppliedScenario {
  configId: number;
  cabinCapacity: number;
}

/** Create a fresh voyage, cabin, and config, then materialize the scenario's rows. */
export async function applyScenario(pool: Pool, key: string): Promise<AppliedScenario> {
  const scenario = SCENARIOS.find((s) => s.key === key);
  if (!scenario) throw new Error(`unknown scenario: ${key}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cfg } = await client.query<{ id: string }>(
      `WITH v AS (INSERT INTO vessels (name) VALUES ($2) RETURNING id),
            c AS (INSERT INTO cabins (vessel_id, name, capacity)
                  SELECT id, 'Economy', $1 FROM v RETURNING id, vessel_id),
            t AS (INSERT INTO voyages (vessel_id, departure_port, departs_at, booking_cutoff_at)
                  SELECT vessel_id, 'Port Aurora', now() + interval '2 days',
                         now() + interval '1 day' FROM c RETURNING id)
       INSERT INTO allocation_configs (voyage_id, cabin_id, cabin_capacity)
       SELECT t.id, c.id, $1 FROM t, c RETURNING id`,
      [scenario.cabinCapacity, `MV ${scenario.title}`],
    );
    const configId = Number(cfg[0]!.id);

    for (const row of scenario.rows) {
      let ownerId: number | null = null;
      if (row.owner) {
        const { rows: o } = await client.query<{ id: string }>(
          'INSERT INTO owners (name, is_hidden) VALUES ($1,$2) RETURNING id',
          [row.owner.name, row.owner.hidden ?? false],
        );
        ownerId = Number(o[0]!.id);
      }
      await client.query(
        `INSERT INTO channel_allocations
           (config_id, channel, owner_id, allocation_type, funding_source,
            allocated_slots, sold_slots, held_slots)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          configId,
          row.channel,
          ownerId,
          row.allocationType,
          row.fundingSource ?? 'online',
          row.allocatedSlots,
          row.soldSlots ?? 0,
          row.heldSlots ?? 0,
        ],
      );
    }

    await client.query(
      `INSERT INTO slot_movements (config_id, event_type, quantity, actor, reason)
       VALUES ($1,'config_init',0,'seed',$2)`,
      [configId, scenario.teaches],
    );
    await client.query('COMMIT');
    return { configId, cabinCapacity: scenario.cabinCapacity };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
