import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { nettedAvailable, type AllocationRow } from '@slot/engine';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/pool.js';

export interface ChannelReport {
  channel: string;
  ownerName: string | null;
  allocationType: string;
  allocatedSeats: number;
  sellableNow: number;
  heldSeats: number;
  soldSeats: number;
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
  channels: ChannelReport[];
}

@Injectable()
export class ReportService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async forConfig(configId: number): Promise<InventoryReport> {
    const client = await this.pool.connect();
    try {
      // All report figures describe one committed point in time, even while
      // other clients are booking and the expiry worker is running.
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const config = await client.query<{ cabin_capacity: number }>('SELECT cabin_capacity FROM allocation_configs WHERE id = $1', [configId]);
      if (!config.rows[0]) throw new NotFoundException('Allocation configuration not found');
      const allocationRows = await client.query<{
        id: string; channel: AllocationRow['channel']; owner_id: string | null;
        allocation_type: AllocationRow['allocationType']; funding_source: AllocationRow['fundingSource'];
        allocated_slots: number; sold_slots: number; held_slots: number; owner_is_hidden: boolean | null;
      }>(
        `SELECT a.id, a.channel, a.owner_id, a.allocation_type, a.funding_source,
                a.allocated_slots, a.sold_slots, a.held_slots, o.is_hidden AS owner_is_hidden
           FROM channel_allocations a LEFT JOIN owners o ON o.id = a.owner_id
          WHERE a.config_id = $1 ORDER BY a.id`, [configId],
      );
      const rows: AllocationRow[] = allocationRows.rows.map((row) => ({
        id: Number(row.id), channel: row.channel, ownerId: row.owner_id === null ? null : Number(row.owner_id),
        allocationType: row.allocation_type, fundingSource: row.funding_source,
        allocatedSlots: row.allocated_slots, soldSlots: row.sold_slots, heldSlots: row.held_slots,
        ownerIsHidden: row.owner_is_hidden ?? false,
      }));
      const owners = await client.query<{ id: string; name: string }>(
        `SELECT DISTINCT o.id, o.name FROM owners o
          JOIN channel_allocations a ON a.owner_id = o.id WHERE a.config_id = $1`, [configId]);
      const movements = await client.query<{ released: string; cutoff: string }>(
        `SELECT COALESCE(SUM(quantity) FILTER (WHERE event_type IN ('release_hold','expire_hold','release_sale')),0)::text AS released,
                COALESCE(SUM(quantity) FILTER (WHERE event_type = 'cutoff_merge'),0)::text AS cutoff
           FROM slot_movements WHERE config_id = $1`, [configId]);
      const due = await client.query<{ seats: string }>(
        `SELECT COALESCE(SUM(quantity),0)::text AS seats FROM slot_holds
          WHERE config_id = $1 AND status = 'open'
            AND expires_at > now() AND expires_at <= now() + interval '5 minutes'`, [configId]);
      const refusals = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM reservation_refusals WHERE config_id = $1', [configId]);
      const names = new Map(owners.rows.map((owner) => [Number(owner.id), owner.name]));
      const channels = rows.map((row) => ({
        channel: row.channel,
        ownerName: row.ownerId === null ? null : names.get(row.ownerId) ?? null,
        allocationType: row.allocationType,
        allocatedSeats: row.allocatedSlots,
        sellableNow: nettedAvailable(row, rows),
        heldSeats: row.heldSlots,
        soldSeats: row.soldSlots,
      }));
      const report = {
        configId,
        physicalCapacity: config.rows[0].cabin_capacity,
        sellableNow: channels.reduce((sum, row) => sum + row.sellableNow, 0),
        heldSeats: channels.reduce((sum, row) => sum + row.heldSeats, 0),
        holdsDueSoon: Number(due.rows[0]?.seats ?? 0),
        confirmedSales: channels.reduce((sum, row) => sum + row.soldSeats, 0),
        releasedSeats: Number(movements.rows[0]?.released ?? 0),
        cutoffReturnedSeats: Number(movements.rows[0]?.cutoff ?? 0),
        preventedOversellAttempts: Number(refusals.rows[0]?.count ?? 0),
        channels,
      };
      await client.query('COMMIT');
      return report;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  toCsv(report: InventoryReport): string {
    const cell = (value: string | number | null) => {
      const raw = String(value ?? '');
      // Names are user supplied. Prevent spreadsheet formula execution on import.
      const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const line = (...values: (string | number | null)[]) => values.map(cell).join(',');
    const metrics: [string, number][] = [
      ['physical_capacity', report.physicalCapacity], ['sellable_now', report.sellableNow],
      ['held_seats', report.heldSeats], ['holds_due_soon', report.holdsDueSoon],
      ['confirmed_sales', report.confirmedSales], ['released_seats', report.releasedSeats],
      ['cutoff_returned_seats', report.cutoffReturnedSeats],
      ['prevented_oversell_attempts', report.preventedOversellAttempts],
    ];
    return [
      line('metric', 'value'), ...metrics.map(([name, value]) => line(name, value)), '',
      line('channel', 'partner', 'allocation_type', 'allocated', 'sellable_now', 'held', 'sold'),
      ...report.channels.map((row) => line(row.channel, row.ownerName, row.allocationType,
        row.allocatedSeats, row.sellableNow, row.heldSeats, row.soldSeats)),
    ].join('\r\n') + '\r\n';
  }
}
