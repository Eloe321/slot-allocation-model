import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  planConsumption,
  selectCandidates,
  type RequesterIdentity,
  type Split,
  type WaterfallTrace,
} from '@slot/engine';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InsufficientCapacityError } from './errors.js';

export interface ReserveInput {
  configId: number;
  identity: RequesterIdentity;
  quantity: number;
  actor: string;
}

export interface ReserveResult {
  token: string;
  expiresAt: Date;
  splits: Split[];
  trace: WaterfallTrace;
}

const HOLD_TTL_SECONDS = Number(process.env.HOLD_TTL_SECONDS ?? 600);

@Injectable()
export class ReservationService {
  constructor(
    private readonly repo: AllocationRepository,
    private readonly ledger: LedgerService,
    private readonly pool: Pool,
  ) {}

  /**
   * Hold seats for `identity`. The engine decides which rows and how much; this
   * method only persists that decision inside the locked transaction.
   */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    return this.repo.withLockedConfig(input.configId, async (ctx) => {
      const trace = selectCandidates(ctx.rows, input.identity);
      const plan = planConsumption(trace, input.quantity);

      if (!plan.ok) {
        throw new InsufficientCapacityError(plan.requested, plan.available, plan.shortfall);
      }

      const token = randomUUID();
      const expiresAt = new Date(Date.now() + HOLD_TTL_SECONDS * 1000);

      for (const split of plan.splits) {
        await ctx.applyDelta(split.rowId, { heldDelta: split.quantity });
        await ctx.client.query(
          `INSERT INTO slot_holds (token, config_id, allocation_id, quantity, expires_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [token, input.configId, split.rowId, split.quantity, expiresAt],
        );
        await this.ledger.record(ctx.client, {
          configId: input.configId,
          allocationId: split.rowId,
          eventType: 'reserve',
          quantity: split.quantity,
          actor: input.actor,
          token,
          reason: `waterfall step: ${split.step}`,
        });
      }

      return { token, expiresAt, splits: plan.splits, trace };
    });
  }

  /** Read-only waterfall preview. Takes no locks and changes nothing. */
  async preview(configId: number, identity: RequesterIdentity): Promise<WaterfallTrace> {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.channel, a.owner_id, a.allocation_type, a.funding_source,
              a.allocated_slots, a.sold_slots, a.held_slots, o.is_hidden AS owner_is_hidden
         FROM channel_allocations a
         LEFT JOIN owners o ON o.id = a.owner_id
        WHERE a.config_id = $1 ORDER BY a.id`,
      [configId],
    );
    return selectCandidates(
      rows.map((r) => ({
        id: Number(r.id),
        channel: r.channel,
        ownerId: r.owner_id === null ? null : Number(r.owner_id),
        allocationType: r.allocation_type,
        fundingSource: r.funding_source,
        allocatedSlots: r.allocated_slots,
        soldSlots: r.sold_slots,
        heldSlots: r.held_slots,
        ownerIsHidden: r.owner_is_hidden ?? false,
      })),
      identity,
    );
  }
}
