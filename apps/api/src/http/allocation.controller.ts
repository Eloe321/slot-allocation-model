import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post } from '@nestjs/common';
import type { Pool } from 'pg';
import { checkInvariants, nettedAvailable, rawAvailable, sumAvailable } from '@slot/engine';
import { ReservationService } from '../reservation/reservation.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CutoffService } from '../cutoff/cutoff.service.js';
import { PG_POOL } from '../db/pool.js';
import { IdentityDto } from './dto.js';
import { toIdentity } from './identity.js';

@Controller('configs')
export class AllocationController {
  constructor(
    private readonly reservations: ReservationService,
    private readonly ledger: LedgerService,
    private readonly cutoff: CutoffService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  /** The tree, with raw and netted availability side by side. */
  @Get(':id')
  async tree(@Param('id', ParseIntPipe) id: number) {
    const rows = await this.reservations.rowsFor(id);
    const { rows: cfg } = await this.pool.query<{ cabin_capacity: number }>(
      'SELECT cabin_capacity FROM allocation_configs WHERE id = $1',
      [id],
    );
    const capacity = cfg[0]?.cabin_capacity ?? 0;
    const owners = await this.pool.query<{ id: string; name: string; is_hidden: boolean }>(
      `SELECT DISTINCT o.id, o.name, o.is_hidden
         FROM owners o JOIN channel_allocations a ON a.owner_id = o.id
        WHERE a.config_id = $1`,
      [id],
    );
    const ownerName = (ownerId: number | null) =>
      ownerId === null ? null : (owners.rows.find((o) => Number(o.id) === ownerId)?.name ?? null);
    return {
      configId: id,
      cabinCapacity: capacity,
      violations: checkInvariants(rows, capacity),
      rows: rows.map((r) => ({
        ...r,
        ownerName: ownerName(r.ownerId),
        rawAvailable: rawAvailable(r),
        nettedAvailable: nettedAvailable(r, rows),
      })),
    };
  }

  /** Read-only waterfall preview: what would happen, without changing anything. */
  @Post(':id/waterfall')
  async waterfall(@Param('id', ParseIntPipe) id: number, @Body() body: IdentityDto) {
    const trace = await this.reservations.preview(id, toIdentity(body));
    return { ...trace, available: sumAvailable(trace) };
  }

  @Get(':id/ledger')
  ledgerFor(@Param('id', ParseIntPipe) id: number) {
    return this.ledger.forConfig(id);
  }

  @Post(':id/cutoff')
  async applyCutoff(@Param('id', ParseIntPipe) id: number) {
    await this.cutoff.apply(id, 'operator');
    return { ok: true };
  }
}
