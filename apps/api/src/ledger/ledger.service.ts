import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

export type LedgerEventType =
  | 'reserve'
  | 'confirm_sale'
  | 'release_hold'
  | 'expire_hold'
  | 'release_sale'
  | 'cutoff_merge'
  | 'config_init';

export interface MovementInput {
  configId: number;
  allocationId?: number | null;
  sourceAllocationId?: number | null;
  destinationAllocationId?: number | null;
  eventType: LedgerEventType;
  quantity: number;
  actor: string;
  reason?: string | null;
  token?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LedgerEntry {
  id: number;
  allocationId: number | null;
  sourceAllocationId: number | null;
  destinationAllocationId: number | null;
  eventType: string;
  quantity: number;
  actor: string;
  reason: string | null;
  token: string | null;
  createdAt: Date;
}

/**
 * Append-only movement log. Every capacity change writes here inside the same
 * transaction that changed it, so the ledger can never disagree with the
 * counters it explains.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly pool: Pool) {}

  async record(client: PoolClient, input: MovementInput): Promise<void> {
    await client.query(
      `INSERT INTO slot_movements
         (config_id, allocation_id, source_allocation_id, destination_allocation_id,
          event_type, quantity, actor, reason, token, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.configId,
        input.allocationId ?? null,
        input.sourceAllocationId ?? null,
        input.destinationAllocationId ?? null,
        input.eventType,
        input.quantity,
        input.actor,
        input.reason ?? null,
        input.token ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async forConfig(configId: number, limit = 200): Promise<LedgerEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT id, allocation_id, source_allocation_id, destination_allocation_id,
              event_type, quantity, actor, reason, token, created_at
         FROM slot_movements WHERE config_id = $1
        ORDER BY id DESC LIMIT $2`,
      [configId, limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      allocationId: r.allocation_id === null ? null : Number(r.allocation_id),
      sourceAllocationId: r.source_allocation_id === null ? null : Number(r.source_allocation_id),
      destinationAllocationId:
        r.destination_allocation_id === null ? null : Number(r.destination_allocation_id),
      eventType: r.event_type,
      quantity: r.quantity,
      actor: r.actor,
      reason: r.reason,
      token: r.token,
      createdAt: r.created_at,
    }));
  }
}
