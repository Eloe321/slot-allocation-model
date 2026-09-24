import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ReservationService } from '../reservation/reservation.service.js';
import { addRow, resetDatabase, seedConfig, testPool } from '../db/test-helpers.js';
import { CrmWebhookService } from './crm-webhook.service.js';

let pool: Pool;
let reservations: ReservationService;
let webhooks: CrmWebhookService;
beforeAll(() => {
  pool = testPool();
  reservations = new ReservationService(new AllocationRepository(pool), new LedgerService(pool), pool);
  webhooks = new CrmWebhookService(pool);
});
beforeEach(async () => resetDatabase(pool));
afterAll(async () => pool.end());

async function confirmedBooking() {
  const { configId } = await seedConfig(pool, 50);
  await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 50 });
  const { token } = await reservations.reserve({ configId, identity: { kind: 'online' }, quantity: 3, actor: 'test' });
  await reservations.confirm(token, 'BK-WEBHOOK', 'test');
  return token;
}

describe('CRM webhook outbox', () => {
  it('enqueues once for an idempotent booking confirmation', async () => {
    const token = await confirmedBooking();
    await reservations.confirm(token, 'BK-WEBHOOK', 'test');
    const deliveries = await webhooks.list();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ eventKey: `booking.confirmed:${token}`, status: 'pending', attempts: 0 });
  });

  it('signs requests, records a failure, and retries with the same idempotency key', async () => {
    const token = await confirmedBooking();
    const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
    const server: Server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      received.push({ headers: request.headers, body });
      response.writeHead(received.length === 1 ? 503 : 200).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing test server port');
      const target = { url: `http://127.0.0.1:${address.port}/crm`, secret: 'test-secret' };
      expect(await webhooks.processDue(target)).toBe(1);
      expect((await webhooks.list())[0]).toMatchObject({ status: 'pending', attempts: 1, lastHttpStatus: 503 });
      await pool.query('UPDATE crm_webhook_deliveries SET next_attempt_at = now() WHERE event_key = $1', [`booking.confirmed:${token}`]);
      expect(await webhooks.processDue(target)).toBe(1);
      expect((await webhooks.list())[0]).toMatchObject({ status: 'delivered', attempts: 2, lastHttpStatus: 200 });
      expect(await webhooks.processDue(target)).toBe(0);
      expect(received).toHaveLength(2);
      expect(received[0]!.headers['idempotency-key']).toBe(`booking.confirmed:${token}`);
      expect(received[1]!.headers['idempotency-key']).toBe(received[0]!.headers['idempotency-key']);
      const digest = createHmac('sha256', target.secret).update(received[0]!.body).digest('hex');
      expect(received[0]!.headers['x-slot-signature']).toBe(`sha256=${digest}`);
      expect((await webhooks.attempts(1))).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not follow a redirect or count a login page as delivered', async () => {
    await confirmedBooking();
    let redirectedRequests = 0;
    const server = createServer((_request, response) => {
      if (_request.url === '/login') {
        redirectedRequests++;
        response.writeHead(200).end('login');
      } else {
        response.writeHead(302, { location: '/login' }).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing test server port');
      expect(await webhooks.processDue({ url: `http://127.0.0.1:${address.port}/crm`, secret: 'test-secret' })).toBe(1);
      expect(redirectedRequests).toBe(0);
      expect((await webhooks.list())[0]).toMatchObject({ status: 'pending', attempts: 1, lastHttpStatus: 302, lastError: 'HTTP 302' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
