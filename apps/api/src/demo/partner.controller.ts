import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/pool.js';
import { DemoRoles, type DemoRequest } from './demo-access.js';

@Controller('partner')
@DemoRoles('partner')
export class PartnerController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('inventory')
  async inventory(@Req() request: DemoRequest) {
    const { rows } = await this.pool.query(
      `SELECT a.id::int AS "allocationId", a.config_id::int AS "configId",
              a.channel, a.allocation_type AS "allocationType",
              a.allocated_slots AS "allocatedSlots", a.held_slots AS "heldSlots",
              a.sold_slots AS "soldSlots",
              greatest(0, a.allocated_slots - a.held_slots - a.sold_slots) AS "availableSlots",
              o.name AS "ownerName", v.name AS "vesselName",
              t.departure_port AS "departurePort", t.departs_at AS "departsAt"
         FROM channel_allocations a
         JOIN owners o ON o.id = a.owner_id
         JOIN allocation_configs c ON c.id = a.config_id
         JOIN voyages t ON t.id = c.voyage_id
         JOIN vessels v ON v.id = t.vessel_id
        WHERE a.owner_id = $1 ORDER BY t.departs_at, a.id`,
      [request.demoPrincipal.ownerId],
    );
    return rows;
  }

  @Get('activity')
  async activity(@Req() request: DemoRequest) {
    const { rows } = await this.pool.query(
      `SELECT m.id::int AS id, m.config_id::int AS "configId",
              m.event_type AS "eventType", m.quantity, m.reason, m.created_at AS "createdAt"
         FROM slot_movements m
         JOIN channel_allocations a ON a.id = m.allocation_id
        WHERE a.owner_id = $1 ORDER BY m.id DESC LIMIT 100`,
      [request.demoPrincipal.ownerId],
    );
    return rows;
  }
}
