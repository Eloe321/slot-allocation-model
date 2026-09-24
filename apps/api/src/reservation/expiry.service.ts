import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Pool } from 'pg';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PG_POOL } from '../db/pool.js';
import { ReservationNotFoundError } from './errors.js';

/**
 * Returns seats from holds whose TTL has passed.
 *
 * A sweeper rather than lazy expiry-on-read (ADR-0010): expired seats must
 * become visible to every reader, not only to whoever happens to touch that row
 * next. A trip nobody queries would otherwise strand its capacity indefinitely.
 */
@Injectable()
export class ExpiryService {
  private readonly logger = new Logger(ExpiryService.name);

  constructor(
    private readonly repo: AllocationRepository,
    private readonly ledger: LedgerService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async scheduledSweep(): Promise<void> {
    const count = await this.sweep();
    if (count > 0) this.logger.log(`expired ${count} reservation(s)`);
  }

  /** Advance one hold to expiry for the guided demo, using the same locked counter and ledger path. */
  async expireNow(token: string): Promise<boolean> {
    const found = await this.pool.query<{ config_id: string }>(
      'SELECT config_id FROM slot_holds WHERE token = $1 LIMIT 1', [token],
    );
    if (!found.rows[0]) throw new ReservationNotFoundError(token);
    return this.repo.withLockedConfig(Number(found.rows[0].config_id), async (ctx) => {
      const holds = await ctx.client.query<{ id: string; allocation_id: string; quantity: number }>(
        `SELECT id, allocation_id, quantity FROM slot_holds
          WHERE token = $1 AND status = 'open' ORDER BY id FOR UPDATE`, [token],
      );
      if (holds.rows.length === 0) return false;
      for (const hold of holds.rows) {
        const allocationId = Number(hold.allocation_id);
        await ctx.applyDelta(allocationId, { heldDelta: -hold.quantity });
        await ctx.client.query("UPDATE slot_holds SET status = 'expired', expires_at = now() WHERE id = $1", [hold.id]);
        await this.ledger.record(ctx.client, {
          configId: ctx.configId, allocationId, eventType: 'expire_hold', quantity: hold.quantity,
          actor: 'demo operator', token, reason: 'guided demo expiry',
        });
      }
      return true;
    });
  }

  /** Returns the number of reservation tokens expired. */
  async sweep(): Promise<number> {
    const { rows } = await this.pool.query<{ token: string; config_id: string }>(
      `SELECT DISTINCT token, config_id FROM slot_holds
        WHERE status = 'open' AND expires_at <= now()`,
    );

    let expired = 0;
    for (const { token, config_id } of rows) {
      await this.repo.withLockedConfig(Number(config_id), async (ctx) => {
        // Re-read under the lock: the token may have been confirmed or released
        // between the scan above and acquiring this lock.
        const holds = await ctx.client.query<{
          id: string;
          allocation_id: string;
          quantity: number;
        }>(
          `SELECT id, allocation_id, quantity FROM slot_holds
            WHERE token = $1 AND status = 'open' AND expires_at <= now()
            ORDER BY id FOR UPDATE`,
          [token],
        );
        if (holds.rowCount === 0) return;

        for (const hold of holds.rows) {
          const allocationId = Number(hold.allocation_id);
          await ctx.applyDelta(allocationId, { heldDelta: -hold.quantity });
          await ctx.client.query(`UPDATE slot_holds SET status = 'expired' WHERE id = $1`, [
            hold.id,
          ]);
          await this.ledger.record(ctx.client, {
            configId: ctx.configId,
            allocationId,
            eventType: 'expire_hold',
            quantity: hold.quantity,
            actor: 'system',
            token,
            reason: 'hold ttl elapsed',
          });
        }
        expired += 1;
      });
    }
    return expired;
  }
}
