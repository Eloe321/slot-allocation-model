import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/pool.js';
import { ConfigurationController } from '../configuration/configuration.controller.js';
import { ConfigurationService } from '../configuration/configuration.service.js';
import { DemoGuard } from './demo-access.js';
import { DemoController } from './demo.controller.js';
import { DemoSessionService } from './demo-session.service.js';
import { DemoRateLimiter } from './demo-rate-limiter.js';
import { PartnerController } from './partner.controller.js';
import { resetDatabase, testPool } from '../db/test-helpers.js';

const proposal = {
  vesselName: 'MV North Star', cabinName: 'Economy', departurePort: 'Manila',
  departsAt: '2026-10-02T08:00:00.000Z', bookingCutoffAt: '2026-10-02T06:00:00.000Z', capacity: 100,
  rows: [
    { channel: 'online', allocationType: 'direct', allocatedSlots: 100 },
    { channel: 'agency', allocationType: 'guaranteed', allocatedSlots: 10, ownerName: 'Harbour Travel' },
    { channel: 'agency', allocationType: 'guaranteed', allocatedSlots: 10, ownerName: 'Northern Tours' },
  ],
};

let pool: Pool;
let app: INestApplication;
let base: string;
beforeAll(async () => {
  pool = testPool();
  const module = await Test.createTestingModule({
    controllers: [DemoController, ConfigurationController, PartnerController],
    providers: [
      { provide: PG_POOL, useValue: pool },
      DemoSessionService,
      DemoRateLimiter,
      ConfigurationService,
      { provide: APP_GUARD, useClass: DemoGuard },
    ],
  }).compile();
  app = module.createNestApplication();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
beforeEach(async () => { await resetDatabase(pool); });
afterAll(async () => { await app.close(); await pool.end(); });

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function session(role: string, ownerId?: number): Promise<string> {
  const response = await post('/demo/sessions', { role, ownerId });
  expect(response.status).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

describe('demo role boundaries', () => {
  it('requires a session and separates submission from approval', async () => {
    expect((await fetch(`${base}/configuration-requests`)).status).toBe(401);
    const operator = await session('operator');
    const submitted = await post('/configuration-requests', proposal, operator);
    expect(submitted.status).toBe(201);
    const { id } = (await submitted.json()) as { id: number };
    expect((await post(`/configuration-requests/${id}/approve`, {}, operator)).status).toBe(403);
    const administrator = await session('administrator');
    const approved = await post(`/configuration-requests/${id}/approve`, {}, administrator);
    expect(approved.status).toBe(201);
    expect((await approved.json()) as { configId: number }).toHaveProperty('configId');
  });

  it('shows each partner only their own allocated inventory', async () => {
    const administrator = await session('administrator');
    const submitted = await post('/configuration-requests', proposal, administrator);
    const { id } = (await submitted.json()) as { id: number };
    await post(`/configuration-requests/${id}/approve`, {}, administrator);
    const identities = await fetch(`${base}/demo/identities`);
    const partners = ((await identities.json()) as Array<{ role: string; label: string; ownerId: number }>).filter((item) => item.role === 'partner');
    const harbour = partners.find((item) => item.label === 'Harbour Travel')!;
    const token = await session('partner', harbour.ownerId);
    const response = await fetch(`${base}/partner/inventory`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const inventory = (await response.json()) as Array<{ ownerName: string; allocatedSlots: number }>;
    expect(inventory).toMatchObject([{ ownerName: 'Harbour Travel', allocatedSlots: 10 }]);
    expect(inventory.some((row) => row.ownerName === 'Northern Tours')).toBe(false);
    expect((await fetch(`${base}/configuration-requests`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
  });

  it('returns actionable statuses for missing and closed review requests', async () => {
    const administrator = await session('administrator');
    expect((await post('/configuration-requests/999999/approve', {}, administrator)).status).toBe(404);
    const submitted = await post('/configuration-requests', proposal, administrator);
    const { id } = (await submitted.json()) as { id: number };
    await post(`/configuration-requests/${id}/reject`, { reason: 'Needs a different cutoff' }, administrator);
    expect((await post(`/configuration-requests/${id}/approve`, {}, administrator)).status).toBe(409);
  });
});
