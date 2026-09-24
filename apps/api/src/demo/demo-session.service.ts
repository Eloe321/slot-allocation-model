import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/pool.js';

export type DemoRole = 'administrator' | 'operator' | 'partner';
export interface DemoPrincipal { role: DemoRole; ownerId: number | null }

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class DemoSessionService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async issue(role: string, ownerId?: number): Promise<{ token: string; expiresAt: Date; principal: DemoPrincipal }> {
    if (!['administrator', 'operator', 'partner'].includes(role)) throw new Error('invalid demo role');
    if (role === 'partner') {
      if (!Number.isSafeInteger(ownerId) || (ownerId ?? 0) < 1) throw new Error('partner role requires an owner');
      const owner = await this.pool.query('SELECT 1 FROM owners WHERE id = $1', [ownerId]);
      if (owner.rowCount === 0) throw new Error('owner not found');
    } else if (ownerId != null) {
      throw new Error('only a partner session may have an owner');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(7129382)');
      await client.query('DELETE FROM demo_sessions WHERE expires_at <= now()');
      const { rows } = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM demo_sessions');
      if (rows[0]!.count >= 500) throw new Error('active demo session limit reached; try again later');
      await client.query(
        'INSERT INTO demo_sessions (token_hash, role, owner_id, expires_at) VALUES ($1,$2,$3,$4)',
        [tokenHash(token), role, role === 'partner' ? ownerId : null, expiresAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return {
      token,
      expiresAt,
      principal: { role: role as DemoRole, ownerId: role === 'partner' ? ownerId! : null },
    };
  }

  async resolve(header: string | undefined): Promise<DemoPrincipal | null> {
    const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(header ?? '');
    if (!match) return null;
    const { rows } = await this.pool.query<{ role: DemoRole; owner_id: string | null }>(
      'SELECT role, owner_id FROM demo_sessions WHERE token_hash = $1 AND expires_at > now()',
      [tokenHash(match[1]!)],
    );
    if (!rows[0]) return null;
    return { role: rows[0].role, ownerId: rows[0].owner_id === null ? null : Number(rows[0].owner_id) };
  }

  async identities(): Promise<Array<{ role: DemoRole; label: string; ownerId: number | null }>> {
    const { rows } = await this.pool.query<{ id: string; name: string }>(
      `SELECT DISTINCT o.id, o.name FROM owners o
         JOIN channel_allocations a ON a.owner_id = o.id
        WHERE o.is_hidden = false ORDER BY o.name, o.id`,
    );
    return [
      { role: 'administrator', label: 'Administrator', ownerId: null },
      { role: 'operator', label: 'Operator', ownerId: null },
      ...rows.map((row) => ({ role: 'partner' as const, label: row.name, ownerId: Number(row.id) })),
    ];
  }
}
