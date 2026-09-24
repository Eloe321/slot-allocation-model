import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { addOwner, resetDatabase, testPool } from '../db/test-helpers.js';
import { DemoSessionService } from './demo-session.service.js';

let pool: Pool;
let service: DemoSessionService;
beforeAll(() => { pool = testPool(); service = new DemoSessionService(pool); });
beforeEach(async () => { await resetDatabase(pool); });
afterAll(async () => { await pool.end(); });

describe('demo sessions', () => {
  it('issues an operator token that resolves to an operator identity', async () => {
    const issued = await service.issue('operator');
    expect(issued.token).toBeTruthy();
    expect(await service.resolve(`Bearer ${issued.token}`)).toEqual({ role: 'operator', ownerId: null });
  });

  it('requires a real owner for a partner session', async () => {
    await expect(service.issue('partner', 999)).rejects.toThrow('owner');
    const ownerId = await addOwner(pool, 'Harbour Travel');
    const issued = await service.issue('partner', ownerId);
    expect(await service.resolve(`Bearer ${issued.token}`)).toEqual({ role: 'partner', ownerId });
  });

  it('rejects missing and expired tokens', async () => {
    expect(await service.resolve(undefined)).toBeNull();
    const issued = await service.issue('administrator');
    await pool.query("UPDATE demo_sessions SET expires_at = now() - interval '1 second'");
    expect(await service.resolve(`Bearer ${issued.token}`)).toBeNull();
  });

  it('prunes expired demo sessions when a new role is selected', async () => {
    await service.issue('operator');
    await pool.query("UPDATE demo_sessions SET expires_at = now() - interval '1 second'");
    await service.issue('administrator');
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM demo_sessions');
    expect(rows[0].count).toBe(1);
  });

  it('bounds the number of active public demo sessions', async () => {
    await pool.query(
      `INSERT INTO demo_sessions (token_hash, role, expires_at)
       SELECT md5(n::text), 'operator', now() + interval '1 hour'
       FROM generate_series(1, 500) AS n`,
    );
    await expect(service.issue('operator')).rejects.toThrow('active demo session limit reached');
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM demo_sessions');
    expect(rows[0].count).toBe(500);
  });
});
