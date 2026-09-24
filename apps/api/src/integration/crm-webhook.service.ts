import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/pool.js';

interface DeliveryRow {
  id: string;
  event_key: string;
  event_type: string;
  payload: unknown;
  status: string;
  attempts: number;
  next_attempt_at: Date;
  last_http_status: number | null;
  last_error: string | null;
  delivered_at: Date | null;
  created_at: Date;
}

export interface WebhookTarget { url: string; secret: string }

@Injectable()
export class CrmWebhookService {
  private readonly logger = new Logger(CrmWebhookService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async scheduledDelivery(): Promise<void> {
    const url = process.env.CRM_WEBHOOK_URL;
    const secret = process.env.CRM_WEBHOOK_SECRET;
    if (!url || !secret) return;
    try { await this.processDue({ url, secret }); }
    catch (error) { this.logger.error(error); }
  }

  async list() {
    const { rows } = await this.pool.query<DeliveryRow>(
      'SELECT * FROM crm_webhook_deliveries ORDER BY id DESC LIMIT 100',
    );
    return rows.map((row) => this.mapDelivery(row));
  }

  async attempts(id: number) {
    const { rows } = await this.pool.query<{ attempted_at: Date; http_status: number | null; error: string | null }>(
      'SELECT attempted_at, http_status, error FROM crm_webhook_attempts WHERE delivery_id = $1 ORDER BY id', [id],
    );
    return rows.map((row) => ({ attemptedAt: row.attempted_at, httpStatus: row.http_status, error: row.error }));
  }

  async retry(id: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE crm_webhook_deliveries SET status = 'pending', attempts = 0, next_attempt_at = now(),
              lease_until = NULL, last_error = NULL
        WHERE id = $1 AND status = 'failed'`, [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async processDue(target: WebhookTarget): Promise<number> {
    const parsed = new URL(target.url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
      throw new Error('CRM webhook target must use HTTPS outside localhost');
    }
    if (!target.secret) throw new Error('CRM webhook secret is required');
    let processed = 0;
    for (let i = 0; i < 20; i++) {
      const claimed = await this.pool.query<DeliveryRow>(
        `UPDATE crm_webhook_deliveries SET status = 'sending', lease_until = now() + interval '30 seconds'
          WHERE id = (
            SELECT id FROM crm_webhook_deliveries
             WHERE (status = 'pending' AND next_attempt_at <= now())
                OR (status = 'sending' AND lease_until < now())
             ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
          ) RETURNING *`,
      );
      const row = claimed.rows[0];
      if (!row) break;
      processed++;
      const body = JSON.stringify(row.payload);
      let httpStatus: number | null = null;
      let error: string | null = null;
      try {
        const response = await fetch(target.url, {
          method: 'POST', signal: AbortSignal.timeout(5000), redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': row.event_key,
            'x-slot-event-id': String(row.id),
            'x-slot-event-type': row.event_type,
            'x-slot-signature': `sha256=${createHmac('sha256', target.secret).update(body).digest('hex')}`,
          },
          body,
        });
        httpStatus = response.status;
        if (!response.ok) error = `HTTP ${response.status}`;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : 'delivery failed';
      }
      const attempts = row.attempts + 1;
      const delivered = error === null;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE crm_webhook_deliveries
            SET status = $2, attempts = $3, last_http_status = $4, last_error = $5,
                delivered_at = CASE WHEN $6 THEN now() ELSE delivered_at END,
                next_attempt_at = now() + ($7 * interval '1 second'), lease_until = NULL
          WHERE id = $1`,
          [row.id, delivered ? 'delivered' : attempts >= 5 ? 'failed' : 'pending', attempts,
            httpStatus, error, delivered, Math.min(300, 2 ** attempts)],
        );
        await client.query(
          'INSERT INTO crm_webhook_attempts (delivery_id, http_status, error) VALUES ($1,$2,$3)',
          [row.id, httpStatus, error],
        );
        await client.query('COMMIT');
      } catch (failure) {
        await client.query('ROLLBACK');
        throw failure;
      } finally {
        client.release();
      }
    }
    return processed;
  }

  private mapDelivery(row: DeliveryRow) {
    return {
      id: Number(row.id), eventKey: row.event_key, eventType: row.event_type,
      payload: row.payload, status: row.status, attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at, lastHttpStatus: row.last_http_status,
      lastError: row.last_error, deliveredAt: row.delivered_at, createdAt: row.created_at,
    };
  }
}
