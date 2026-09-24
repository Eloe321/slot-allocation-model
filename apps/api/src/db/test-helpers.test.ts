import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { resetDatabase } from './test-helpers.js';

describe('test database reset guard', () => {
  it('refuses to truncate a non-test database', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ database_name: 'slot_allocation' }] });
    await expect(resetDatabase({ query } as unknown as Pool)).rejects.toThrow('Refusing to reset non-test database');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toBe('SELECT current_database() AS database_name');
  });
});
