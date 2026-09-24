import { Client } from 'pg';

const testUrl = new URL(
  process.env.TEST_DATABASE_URL ?? 'postgres://slot:slot@localhost:55432/slot_allocation_test',
);
const databaseName = decodeURIComponent(testUrl.pathname.slice(1));

if (!/^[a-z][a-z0-9_]*_test$/.test(databaseName)) {
  throw new Error('Test database name must end in _test and contain only lowercase letters, digits, and underscores');
}

testUrl.pathname = '/postgres';
const client = new Client({ connectionString: testUrl.toString() });

try {
  await client.connect();
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  if (existing.rowCount === 0) {
    await client.query(`CREATE DATABASE "${databaseName}"`);
    console.log(`created ${databaseName}`);
  } else {
    console.log(`${databaseName} already exists`);
  }
} finally {
  await client.end();
}
