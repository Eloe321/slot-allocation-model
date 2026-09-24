import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/pool.js';
import { listScenarios, resetScenario } from '../seed/scenarios.js';
import { DemoRoles } from '../demo/demo-access.js';

@Controller('scenarios')
@DemoRoles('administrator', 'operator')
export class ScenarioController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The catalogue, each entry paired with the config currently materializing it. */
  @Get()
  async list() {
    const { rows } = await this.pool.query<{ id: string; scenario_key: string }>(
      `SELECT id, scenario_key FROM allocation_configs
        WHERE scenario_key IS NOT NULL ORDER BY id`,
    );
    return listScenarios().map((s) => ({
      ...s,
      configId: rows.find((r) => r.scenario_key === s.key)?.id ?? null,
    }));
  }

  @Post(':key/reset')
  async reset(@Param('key') key: string) {
    return resetScenario(this.pool, key);
  }
}
