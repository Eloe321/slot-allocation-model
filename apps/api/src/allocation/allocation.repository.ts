import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { AllocationRow } from '@slot/engine';
import { PG_POOL } from '../db/pool.js';

export interface ConfigContext {
  client: PoolClient;
  configId: number;
  cabinCapacity: number;
  cutoffAppliedAt: Date | null;
  rows: AllocationRow[];
  applyDelta(
    rowId: number,
    delta: { heldDelta?: number; soldDelta?: number; allocatedDelta?: number },
  ): Promise<void>;
}

interface DbRow {
  id: string;
  channel: AllocationRow['channel'];
  owner_id: string | null;
  allocation_type: AllocationRow['allocationType'];
  funding_source: AllocationRow['fundingSource'];
  allocated_slots: number;
  sold_slots: number;
  held_slots: number;
  owner_is_hidden: boolean | null;
}

function toEngineRow(r: DbRow): AllocationRow {
  return {
    id: Number(r.id),
    channel: r.channel,
    ownerId: r.owner_id === null ? null : Number(r.owner_id),
    allocationType: r.allocation_type,
    fundingSource: r.funding_source,
    allocatedSlots: r.allocated_slots,
    soldSlots: r.sold_slots,
    heldSlots: r.held_slots,
    ownerIsHidden: r.owner_is_hidden ?? false,
  };
}

@Injectable()
export class AllocationRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Run `fn` inside one transaction with the config and all of its allocation
   * rows locked.
   *
   * The config row is locked first, which serializes concurrent writers on one
   * config. The allocation rows are then locked `ORDER BY id`, giving every
   * transaction the same acquisition order and removing the deadlock that
   * arbitrary ordering would produce between overlapping requests.
   */
  async withLockedConfig<T>(configId: number, fn: (ctx: ConfigContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const config = await client.query<{
        id: string;
        cabin_capacity: number;
        cutoff_applied_at: Date | null;
      }>(
        `SELECT id, cabin_capacity, cutoff_applied_at
           FROM allocation_configs WHERE id = $1 FOR UPDATE`,
        [configId],
      );
      if (config.rowCount === 0) {
        throw new Error(`allocation config ${configId} not found`);
      }

      const rows = await client.query<DbRow>(
        `SELECT a.id, a.channel, a.owner_id, a.allocation_type, a.funding_source,
                a.allocated_slots, a.sold_slots, a.held_slots, o.is_hidden AS owner_is_hidden
           FROM channel_allocations a
           LEFT JOIN owners o ON o.id = a.owner_id
          WHERE a.config_id = $1
          ORDER BY a.id
            FOR UPDATE OF a`,
        [configId],
      );

      const ctx: ConfigContext = {
        client,
        configId,
        cabinCapacity: config.rows[0]!.cabin_capacity,
        cutoffAppliedAt: config.rows[0]!.cutoff_applied_at,
        rows: rows.rows.map(toEngineRow),
        applyDelta: async (rowId, delta) => {
          await client.query(
            `UPDATE channel_allocations
                SET held_slots      = held_slots      + $2,
                    sold_slots      = sold_slots      + $3,
                    allocated_slots = allocated_slots + $4
              WHERE id = $1`,
            [rowId, delta.heldDelta ?? 0, delta.soldDelta ?? 0, delta.allocatedDelta ?? 0],
          );
        },
      };

      const result = await fn(ctx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
