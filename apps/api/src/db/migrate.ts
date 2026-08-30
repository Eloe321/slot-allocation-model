import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './pool.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle/migrations');

async function main(): Promise<void> {
  const pool = createPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rowCount } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (rowCount) continue;
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
