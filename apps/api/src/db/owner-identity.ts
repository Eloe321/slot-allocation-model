import type { PoolClient } from 'pg';

/** Keep the same visible partner ID across configurations and concurrent approvals. */
export async function visibleOwnerId(client: PoolClient, name: string): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO owners (name, is_hidden) VALUES ($1, false)
     ON CONFLICT ((lower(btrim(name)))) WHERE is_hidden = false
     DO UPDATE SET name = owners.name
     RETURNING id`,
    [name.trim()],
  );
  return Number(rows[0]!.id);
}
