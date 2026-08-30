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
import { InsufficientCapacityError, ReservationNotFoundError, ReservationNotOpenError } from './errors.js';

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

  /**
   * Confirm every split under `token` in one transaction: held decreases, sold
   * increases, and a durable link records exactly which row each seat came from.
   *
   * The link — not the booking's declared channel — is what a later release
   * reads, which is the only correct answer when the waterfall drew from
   * several rows.
   */
  async confirm(
    token: string,
    bookingRef: string,
    actor: string,
  ): Promise<{ alreadyConfirmed: boolean; splits: Split[] }> {
    const configId = await this.configIdForToken(token);
    return this.repo.withLockedConfig(configId, async (ctx) => {
      const holds = await ctx.client.query<{
        id: string;
        allocation_id: string;
        quantity: number;
        status: string;
      }>(
        `SELECT id, allocation_id, quantity, status FROM slot_holds
          WHERE token = $1 ORDER BY id FOR UPDATE`,
        [token],
      );

      if (holds.rows.every((h) => h.status === 'confirmed')) {
        return {
          alreadyConfirmed: true,
          splits: holds.rows.map((h) => ({
            rowId: Number(h.allocation_id),
            step: 'primary' as const,
            quantity: h.quantity,
          })),
        };
      }

      const notOpen = holds.rows.find((h) => h.status !== 'open');
      if (notOpen) throw new ReservationNotOpenError(token, notOpen.status);

      const splits: Split[] = [];
      for (const hold of holds.rows) {
        const allocationId = Number(hold.allocation_id);
        await ctx.applyDelta(allocationId, {
          heldDelta: -hold.quantity,
          soldDelta: hold.quantity,
        });
        await ctx.client.query(`UPDATE slot_holds SET status = 'confirmed' WHERE id = $1`, [
          hold.id,
        ]);
        await ctx.client.query(
          `INSERT INTO booking_slot_links (booking_ref, config_id, allocation_id, quantity)
           VALUES ($1,$2,$3,$4)`,
          [bookingRef, configId, allocationId, hold.quantity],
        );
        await this.ledger.record(ctx.client, {
          configId,
          allocationId,
          eventType: 'confirm_sale',
          quantity: hold.quantity,
          actor,
          token,
          reason: `booking ${bookingRef}`,
        });
        splits.push({ rowId: allocationId, step: 'primary', quantity: hold.quantity });
      }
      return { alreadyConfirmed: false, splits };
    });
  }

  /** Return an open hold's seats to the exact rows they were taken from. */
  async release(token: string, actor: string): Promise<void> {
    const configId = await this.configIdForToken(token);
    await this.repo.withLockedConfig(configId, async (ctx) => {
      const holds = await ctx.client.query<{
        id: string;
        allocation_id: string;
        quantity: number;
        status: string;
      }>(
        `SELECT id, allocation_id, quantity, status FROM slot_holds
          WHERE token = $1 ORDER BY id FOR UPDATE`,
        [token],
      );

      const notOpen = holds.rows.find((h) => h.status !== 'open');
      if (notOpen) throw new ReservationNotOpenError(token, notOpen.status);

      for (const hold of holds.rows) {
        const allocationId = Number(hold.allocation_id);
        await ctx.applyDelta(allocationId, { heldDelta: -hold.quantity });
        await ctx.client.query(`UPDATE slot_holds SET status = 'released' WHERE id = $1`, [hold.id]);
        await this.ledger.record(ctx.client, {
          configId,
          allocationId,
          eventType: 'release_hold',
          quantity: hold.quantity,
          actor,
          token,
        });
      }
    });
  }

  private async configIdForToken(token: string): Promise<number> {
    const { rows } = await this.pool.query<{ config_id: string }>(
      'SELECT config_id FROM slot_holds WHERE token = $1 LIMIT 1',
      [token],
    );
    if (rows.length === 0) throw new ReservationNotFoundError(token);
    return Number(rows[0]!.config_id);
  }
}
