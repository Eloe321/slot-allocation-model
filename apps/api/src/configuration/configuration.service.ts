import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/pool.js';
import { visibleOwnerId } from '../db/owner-identity.js';
import { previewConfiguration, type ConfigurationInput } from './configuration.preview.js';

export class ConfigurationValidationError extends Error {
  constructor(readonly violations: ReturnType<typeof previewConfiguration>['violations']) {
    super(violations.map((violation) => violation.code).join(', '));
  }
}

interface RequestRow {
  id: string;
  status: 'submitted' | 'approved' | 'rejected';
  proposed: unknown;
  submitted_by: string;
  reviewed_by: string | null;
  review_reason: string | null;
  config_id: string | null;
  created_at: Date;
  reviewed_at: Date | null;
}

@Injectable()
export class ConfigurationService {
  private readonly logger = new Logger(ConfigurationService.name);
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async submit(value: unknown, actor: string): Promise<{ id: number; status: 'submitted' }> {
    const preview = previewConfiguration(value);
    if (preview.violations.length > 0) throw new ConfigurationValidationError(preview.violations);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(7129381)');
      const { rows: counts } = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM configuration_requests',
      );
      if (counts[0]!.count >= 100) throw new ConflictException('demo configuration limit reached; try again after automatic cleanup');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO configuration_requests (proposed, submitted_by)
         VALUES ($1::jsonb, $2) RETURNING id`,
        [JSON.stringify(preview.input), actor],
      );
      await client.query('COMMIT');
      return { id: Number(rows[0]!.id), status: 'submitted' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledCleanup(): Promise<void> {
    try { await this.cleanupExpired(); }
    catch (error) { this.logger.error(error); }
  }

  /** Retire public demo proposals and their custom sailings after 24 hours. */
  async cleanupExpired(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(7129381)');
      await client.query(
        `DELETE FROM vessels v WHERE EXISTS (
           SELECT 1 FROM configuration_requests r
           JOIN allocation_configs c ON c.id = r.config_id
           JOIN voyages t ON t.id = c.voyage_id
           WHERE r.created_at < now() - interval '24 hours' AND t.vessel_id = v.id
         )`,
      );
      await client.query("DELETE FROM configuration_requests WHERE created_at < now() - interval '24 hours'");
      await client.query(
        `DELETE FROM owners o WHERE o.created_at < now() - interval '24 hours'
           AND NOT EXISTS (SELECT 1 FROM channel_allocations a WHERE a.owner_id = o.id)`,
      );
      await client.query('DELETE FROM demo_sessions WHERE expires_at <= now()');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(): Promise<Array<{
    id: number;
    status: RequestRow['status'];
    proposed: unknown;
    submittedBy: string;
    reviewedBy: string | null;
    reviewReason: string | null;
    configId: number | null;
    createdAt: Date;
    reviewedAt: Date | null;
  }>> {
    const { rows } = await this.pool.query<RequestRow>(
      'SELECT * FROM configuration_requests ORDER BY created_at DESC, id DESC',
    );
    return rows.map((row) => ({
      id: Number(row.id),
      status: row.status,
      proposed: row.proposed,
      submittedBy: row.submitted_by,
      reviewedBy: row.reviewed_by,
      reviewReason: row.review_reason,
      configId: row.config_id === null ? null : Number(row.config_id),
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
    }));
  }

  async approve(id: number, actor: string): Promise<{ configId: number; alreadyApproved: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<RequestRow>(
        'SELECT * FROM configuration_requests WHERE id = $1 FOR UPDATE',
        [id],
      );
      const request = rows[0];
      if (!request) throw new NotFoundException(`configuration request ${id} not found`);
      if (request.status === 'approved' && request.config_id !== null) {
        await client.query('COMMIT');
        return { configId: Number(request.config_id), alreadyApproved: true };
      }
      if (request.status === 'rejected') throw new ConflictException(`configuration request ${id} was rejected`);

      const preview = previewConfiguration(request.proposed);
      if (preview.violations.length > 0) throw new ConfigurationValidationError(preview.violations);
      const configId = await this.materialize(client, preview.input, actor);
      await client.query(
        `UPDATE configuration_requests
            SET status = 'approved', config_id = $2, reviewed_by = $3, reviewed_at = now()
          WHERE id = $1`,
        [id, configId, actor],
      );
      await client.query('COMMIT');
      return { configId, alreadyApproved: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reject(id: number, actor: string, reason: string): Promise<void> {
    if (reason.trim().length === 0) throw new BadRequestException('review reason is required');
    const { rowCount } = await this.pool.query(
      `UPDATE configuration_requests
          SET status = 'rejected', reviewed_by = $2, review_reason = $3, reviewed_at = now()
        WHERE id = $1 AND status = 'submitted'`,
      [id, actor, reason.trim()],
    );
    if (rowCount === 0) {
      const found = await this.pool.query('SELECT 1 FROM configuration_requests WHERE id = $1', [id]);
      if (found.rowCount === 0) throw new NotFoundException(`configuration request ${id} not found`);
      throw new ConflictException(`configuration request ${id} is not open`);
    }
  }

  private async materialize(client: PoolClient, input: ConfigurationInput, actor: string): Promise<number> {
    const vessel = await client.query<{ id: string }>(
      'INSERT INTO vessels (name) VALUES ($1) RETURNING id',
      [input.vesselName],
    );
    const vesselId = Number(vessel.rows[0]!.id);
    const cabin = await client.query<{ id: string }>(
      'INSERT INTO cabins (vessel_id, name, capacity) VALUES ($1,$2,$3) RETURNING id',
      [vesselId, input.cabinName, input.capacity],
    );
    const voyage = await client.query<{ id: string }>(
      `INSERT INTO voyages (vessel_id, departure_port, departs_at, booking_cutoff_at)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [vesselId, input.departurePort, input.departsAt, input.bookingCutoffAt],
    );
    const config = await client.query<{ id: string }>(
      `INSERT INTO allocation_configs (voyage_id, cabin_id, cabin_capacity)
       VALUES ($1,$2,$3) RETURNING id`,
      [voyage.rows[0]!.id, cabin.rows[0]!.id, input.capacity],
    );
    const configId = Number(config.rows[0]!.id);
    const owners = new Map<string, number>();
    for (const row of input.rows) {
      let ownerId: number | null = null;
      if (row.ownerName !== null) {
        const key = row.ownerName.toLocaleLowerCase();
        if (!owners.has(key)) {
          owners.set(key, await visibleOwnerId(client, row.ownerName));
        }
        ownerId = owners.get(key)!;
      }
      await client.query(
        `INSERT INTO channel_allocations
           (config_id, channel, owner_id, allocation_type, funding_source, allocated_slots)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [configId, row.channel, ownerId, row.allocationType, row.fundingSource, row.allocatedSlots],
      );
    }
    await client.query(
      `INSERT INTO slot_movements (config_id, event_type, quantity, actor, reason)
       VALUES ($1, 'config_approved', 0, $2, 'configuration request approved')`,
      [configId, actor],
    );
    return configId;
  }
}
