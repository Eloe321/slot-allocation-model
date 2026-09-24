import { spawn } from 'node:child_process';
import { Client } from 'pg';
import { DATABASE_URL } from './pool.js';

async function databaseReady(): Promise<boolean> {
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (await databaseReady()) {
  console.log('PostgreSQL is ready');
} else {
  console.log('Starting PostgreSQL with Docker Compose');
  const command = spawn('docker', ['compose', 'up', '-d', '--wait', 'db'], {
    cwd: new URL('../../../../', import.meta.url).pathname,
    stdio: 'inherit',
    signal: AbortSignal.timeout(120_000),
  });
  const status = await new Promise<number>((resolve, reject) => {
    command.on('error', reject);
    command.on('close', (code) => resolve(code ?? 1));
  });
  if (status !== 0 || !(await databaseReady())) {
    throw new Error('PostgreSQL did not become ready; check Docker Compose and DATABASE_URL');
  }
  console.log('PostgreSQL is ready');
}
