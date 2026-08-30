import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { listScenarios, resetScenario } from '../seed/scenarios.js';
import { testPool, resetDatabase } from '../db/test-helpers.js';

let pool: Pool;
beforeAll(() => { pool = testPool(); });
beforeEach(async () => { await resetDatabase(pool); });
afterAll(async () => { await pool.end(); });

describe('scenario catalogue', () => {
  it('lists every scenario with its key, title and teaching note', () => {
    const list = listScenarios();
    expect(list.length).toBeGreaterThanOrEqual(6);
    for (const s of list) {
      expect(s.key).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.teaches).toBeTruthy();
    }
  });

  it('reset returns a config id that is immediately readable', async () => {
    const { configId } = await resetScenario(pool, 'double-count-trap');
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM channel_allocations WHERE config_id = $1',
      [configId],
    );
    expect(rows[0].n).toBe(6);
  });

  it('reset is repeatable and leaves exactly one config for that scenario', async () => {
    const first = await resetScenario(pool, 'double-count-trap');
    const second = await resetScenario(pool, 'double-count-trap');
    expect(second.configId).not.toBe(first.configId);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM channel_allocations WHERE config_id = $1',
      [first.configId],
    );
    // The previous instance is gone, so a reviewer cannot accumulate stale trees.
    expect(rows[0].n).toBe(0);
  });

  it('rejects an unknown scenario key', async () => {
    await expect(resetScenario(pool, 'nope')).rejects.toThrow('unknown scenario');
  });
});
