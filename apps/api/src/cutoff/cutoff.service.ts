import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/pool.js';
import { nettedAvailable, type AllocationRow } from '@slot/engine';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';

/**
 * At the booking cutoff, unsold capacity that channels no longer need is
 * consolidated onto the counter so walk-up customers can buy it.
 *
 * `flexible` children and direct `online` / `marketplace` rows give up their
 * free portion. `guaranteed` children keep theirs — that is what the guarantee
 * means. Sold and held seats are never moved.
 */
@Injectable()
export class CutoffService {
  private readonly logger = new Logger(CutoffService.name);

  constructor(
    private readonly repo: AllocationRepository,
    private readonly ledger: LedgerService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledSweep(): Promise<void> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT c.id FROM allocation_configs c
         JOIN voyages v ON v.id = c.voyage_id
        WHERE c.cutoff_enabled AND c.cutoff_applied_at IS NULL
          AND v.booking_cutoff_at <= now()`,
    );
    for (const { id } of rows) {
      await this.apply(Number(id), 'system');
    }
    if (rows.length > 0) this.logger.log(`applied cutoff to ${rows.length} config(s)`);
  }

  async apply(configId: number, actor: string): Promise<void> {
    await this.repo.withLockedConfig(configId, async (ctx) => {
      // Re-checked under the lock so two concurrent sweeps cannot both apply.
      if (ctx.cutoffAppliedAt !== null) return;

      const counter =
        ctx.rows.find((r) => r.channel === 'counter' && r.allocationType === 'direct') ??
        (await this.createCounterRow(ctx.client, configId));

      // Netted, not raw. A parent's raw free portion includes seats its children
      // already hold; releasing that to counter hands the same seat to two
      // places. `nettedAvailable` is the same function the display path uses, so
      // cutoff and availability can never disagree about what "free" means.
      const nettedFree = (row: AllocationRow): number => nettedAvailable(row, ctx.rows);

      const onlineParent = ctx.rows.find(
        (r) => r.channel === 'online' && r.ownerId === null && r.allocationType === 'direct',
      );
      const poolRow = ctx.rows.find((r) => r.channel === 'partner_pool');

      let moved = 0;
      let onlineGivenBack = 0;
      let poolGivenBack = 0;

      for (const row of ctx.rows) {
        if (row.id === counter.id) continue;
        const eligible =
          row.allocationType === 'flexible' ||
          (row.allocationType === 'direct' &&
            (row.channel === 'online' || row.channel === 'marketplace'));
        if (!eligible) continue;

        const movable = nettedFree(row);
        if (movable <= 0) continue;

        await ctx.applyDelta(row.id, { allocatedDelta: -movable });
        moved += movable;

        // A child giving up capacity already returns that headroom to its
        // funding parent. Crediting counter as well would count it twice, so
        // the parent must shrink by the same amount. This is what keeps the
        // sum of direct allocations equal to cabin capacity.
        if (row.allocationType === 'flexible') {
          if (row.fundingSource === 'partner_pool') poolGivenBack += movable;
          else onlineGivenBack += movable;
        }
        await this.ledger.record(ctx.client, {
          configId,
          allocationId: row.id,
          sourceAllocationId: row.id,
          destinationAllocationId: counter.id,
          eventType: 'cutoff_merge',
          quantity: movable,
          actor,
          reason: `released ${row.allocationType} ${row.channel} capacity to counter`,
        });
      }

      // The partner pool is itself a child of online, so headroom it returns
      // must propagate up one more level.
      if (poolRow && poolGivenBack > 0) {
        await ctx.applyDelta(poolRow.id, { allocatedDelta: -poolGivenBack });
        onlineGivenBack += poolGivenBack;
      }
      if (onlineParent && onlineGivenBack > 0) {
        await ctx.applyDelta(onlineParent.id, { allocatedDelta: -onlineGivenBack });
      }

      if (moved > 0) {
        await ctx.applyDelta(counter.id, { allocatedDelta: moved });
      }

      await ctx.client.query(
        'UPDATE allocation_configs SET cutoff_applied_at = now() WHERE id = $1',
        [configId],
      );
    });
  }

  private async createCounterRow(
    client: import('pg').PoolClient,
    configId: number,
  ): Promise<{ id: number }> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO channel_allocations
         (config_id, channel, allocation_type, funding_source, allocated_slots)
       VALUES ($1,'counter','direct','online',0) RETURNING id`,
      [configId],
    );
    return { id: Number(rows[0]!.id) };
  }
}
