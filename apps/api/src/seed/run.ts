import { createPool } from '../db/pool.js';
import { SCENARIOS, applyScenario } from './scenarios.js';

async function main(): Promise<void> {
  const pool = createPool();
  if (process.argv.includes('--if-empty')) {
    const existing = await pool.query('SELECT 1 FROM allocation_configs LIMIT 1');
    if (existing.rowCount) {
      console.log('demo database already seeded; keeping current configurations');
      await pool.end();
      return;
    }
  }
  await pool.query(`
    TRUNCATE slot_movements, booking_slot_links, slot_holds,
             channel_allocations, allocation_configs, voyages, cabins, vessels, owners
    RESTART IDENTITY CASCADE
  `);
  for (const scenario of SCENARIOS) {
    const { configId } = await applyScenario(pool, scenario.key);
    console.log(`config ${configId}  ${scenario.key}  ${scenario.title}`);
  }
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
