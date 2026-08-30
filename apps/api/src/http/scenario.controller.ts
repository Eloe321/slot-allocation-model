import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/pool.js';
import { listScenarios, resetScenario } from '../seed/scenarios.js';

@Controller('scenarios')
export class ScenarioController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The catalogue, each entry paired with the config currently materializing it. */
  @Get()
  async list() {
    const { rows } = await this.pool.query<{ id: string; name: string }>(
      `SELECT c.id, v.name FROM allocation_configs c
         JOIN voyages t ON t.id = c.voyage_id
         JOIN vessels v ON v.id = t.vessel_id
        ORDER BY c.id`,
    );
    return listScenarios().map((s) => ({
      ...s,
      configId: rows.find((r) => r.name === `MV ${s.title}`)?.id ?? null,
    }));
  }

  @Post(':key/reset')
  async reset(@Param('key') key: string) {
    return resetScenario(this.pool, key);
  }
}
