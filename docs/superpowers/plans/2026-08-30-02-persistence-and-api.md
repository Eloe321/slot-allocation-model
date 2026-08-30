# Slot Allocation (Plan 02: Persistence, Service, API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the pure engine behind a transactional NestJS shell backed by PostgreSQL — locking, holds, links, cutoff, ledger — and prove under concurrent load that it cannot oversell.

**Architecture:** The service layer adds no decision logic. It locks rows, hands plain objects to `@slot/engine`, applies the returned splits, and appends to the ledger. Correctness is defended in three independent layers: engine invariants (Plan 01), the transaction, and database constraints that cannot be bypassed.

**Tech Stack:** NestJS 11, PostgreSQL 16 via Docker Compose, Drizzle ORM for schema and typed reads, raw SQL for the locking walk and constraint triggers, Vitest 3 for integration tests.

**Prerequisite:** Plan 01 complete — `pnpm --filter @slot/engine test` passes.

---

## File Structure

| File | Responsibility |
|---|---|
| `docker-compose.yml` | PostgreSQL 16 with healthcheck and named volume |
| `apps/api/package.json` | API manifest and scripts |
| `apps/api/drizzle/schema.ts` | Drizzle table definitions |
| `apps/api/drizzle/migrations/0000_init.sql` | Tables, checks, indexes |
| `apps/api/drizzle/migrations/0001_pool_ceilings.sql` | Deferred constraint triggers |
| `apps/api/src/db/db.module.ts` | Pool provider, transaction helper |
| `apps/api/src/allocation/allocation.repository.ts` | Locking load, delta application |
| `apps/api/src/ledger/ledger.service.ts` | Append-only movement writes |
| `apps/api/src/reservation/reservation.service.ts` | Reserve, confirm, release |
| `apps/api/src/reservation/expiry.service.ts` | TTL sweeper |
| `apps/api/src/cutoff/cutoff.service.ts` | Release to counter at cutoff |
| `apps/api/src/http/*.controller.ts` | HTTP surface and DTO boundary |
| `apps/api/src/seed/scenarios.ts` | Named scenario fixtures |

---

### Task 1: PostgreSQL and the API package

**Files:**
- Create: `docker-compose.yml`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/.env.example`
- Create: `apps/api/vitest.config.ts`

- [ ] **Step 1: Create the compose file**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: slot_allocation_db
    environment:
      POSTGRES_USER: slot
      POSTGRES_PASSWORD: slot
      POSTGRES_DB: slot_allocation
    ports:
      - "55432:5432"
    volumes:
      - slot_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U slot -d slot_allocation"]
      interval: 2s
      timeout: 3s
      retries: 20

volumes:
  slot_pgdata:
```

Port 55432 rather than 5432 so the repo does not collide with a local PostgreSQL a reviewer already runs.

- [ ] **Step 2: Create the API manifest**

`apps/api/package.json`:

```json
{
  "name": "@slot/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:seed": "tsx src/seed/run.ts"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/schedule": "^5.0.0",
    "@slot/engine": "workspace:*",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "drizzle-orm": "^0.38.3",
    "pg": "^8.13.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/node": "^22.10.5",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

- [ ] **Step 3: Create the configs**

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "outDir": "dist"
  },
  "include": ["src", "drizzle"]
}
```

`apps/api/.env.example`:

```
DATABASE_URL=postgres://slot:slot@localhost:55432/slot_allocation
HOLD_TTL_SECONDS=600
```

`apps/api/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one database; run files serially to keep
    // truncation between tests deterministic.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 4: Install and start the database**

Run: `pnpm install`
Expected: resolves; `@slot/engine` links as a workspace dependency.

Run: `docker compose up -d && docker compose ps`
Expected: `slot_allocation_db` listed as `healthy` within about ten seconds.

Run: `cp apps/api/.env.example apps/api/.env`

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml apps/api pnpm-lock.yaml
git commit -m "chore(api): scaffold nest api package and postgres compose service"
```

---

### Task 2: Schema and per-row constraints

**Files:**
- Create: `apps/api/drizzle/migrations/0000_init.sql`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/src/db/pool.ts`

- [ ] **Step 1: Write the migration**

`apps/api/drizzle/migrations/0000_init.sql`:

```sql
CREATE TABLE owners (
  id          bigserial PRIMARY KEY,
  name        text        NOT NULL,
  is_hidden   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vessels (
  id    bigserial PRIMARY KEY,
  name  text NOT NULL
);

CREATE TABLE cabins (
  id         bigserial PRIMARY KEY,
  vessel_id  bigint NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  name       text   NOT NULL,
  capacity   integer NOT NULL CHECK (capacity > 0)
);

CREATE TABLE voyages (
  id                bigserial PRIMARY KEY,
  vessel_id         bigint      NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  departure_port    text        NOT NULL,
  departs_at        timestamptz NOT NULL,
  booking_cutoff_at timestamptz NOT NULL
);

CREATE TABLE allocation_configs (
  id                bigserial PRIMARY KEY,
  voyage_id         bigint  NOT NULL REFERENCES voyages(id) ON DELETE CASCADE,
  cabin_id          bigint  NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
  cabin_capacity    integer NOT NULL CHECK (cabin_capacity > 0),
  cutoff_enabled    boolean NOT NULL DEFAULT true,
  cutoff_applied_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (voyage_id, cabin_id)
);

CREATE TYPE channel AS ENUM
  ('counter','online','marketplace','partner_pool','agency','reseller');
CREATE TYPE allocation_type AS ENUM ('direct','flexible','guaranteed');
CREATE TYPE funding_source AS ENUM ('online','partner_pool');

CREATE TABLE channel_allocations (
  id               bigserial PRIMARY KEY,
  config_id        bigint          NOT NULL REFERENCES allocation_configs(id) ON DELETE CASCADE,
  channel          channel         NOT NULL,
  owner_id         bigint          REFERENCES owners(id) ON DELETE RESTRICT,
  allocation_type  allocation_type NOT NULL,
  funding_source   funding_source  NOT NULL DEFAULT 'online',
  allocated_slots  integer         NOT NULL CHECK (allocated_slots >= 0),
  sold_slots       integer         NOT NULL DEFAULT 0 CHECK (sold_slots  >= 0),
  held_slots       integer         NOT NULL DEFAULT 0 CHECK (held_slots  >= 0),
  created_at       timestamptz     NOT NULL DEFAULT now(),

  -- Layer three. Even a future code path that forgets to check cannot oversell
  -- a single row past its allocation.
  CONSTRAINT row_not_overcommitted
    CHECK (sold_slots + held_slots <= allocated_slots),

  -- Owned channels must carry an owner; unowned channels must not.
  CONSTRAINT owner_matches_channel CHECK (
    (channel IN ('agency','reseller') AND owner_id IS NOT NULL) OR
    (channel NOT IN ('agency','reseller') AND owner_id IS NULL)
  ),

  -- Direct rows are top-level partitions and are never carved from the pool.
  CONSTRAINT direct_is_online_funded CHECK (
    allocation_type <> 'direct' OR funding_source = 'online'
  )
);

CREATE INDEX channel_allocations_config_idx ON channel_allocations (config_id, id);

CREATE TYPE hold_status AS ENUM ('open','confirmed','released','expired');

CREATE TABLE slot_holds (
  id             bigserial PRIMARY KEY,
  token          uuid        NOT NULL,
  config_id      bigint      NOT NULL REFERENCES allocation_configs(id) ON DELETE CASCADE,
  allocation_id  bigint      NOT NULL REFERENCES channel_allocations(id) ON DELETE CASCADE,
  quantity       integer     NOT NULL CHECK (quantity > 0),
  status         hold_status NOT NULL DEFAULT 'open',
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX slot_holds_token_idx  ON slot_holds (token);
CREATE INDEX slot_holds_sweep_idx  ON slot_holds (status, expires_at);

CREATE TABLE booking_slot_links (
  id             bigserial PRIMARY KEY,
  booking_ref    text        NOT NULL,
  config_id      bigint      NOT NULL REFERENCES allocation_configs(id) ON DELETE CASCADE,
  allocation_id  bigint      NOT NULL REFERENCES channel_allocations(id) ON DELETE RESTRICT,
  quantity       integer     NOT NULL CHECK (quantity > 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX booking_slot_links_ref_idx ON booking_slot_links (booking_ref);

CREATE TABLE slot_movements (
  id                        bigserial PRIMARY KEY,
  config_id                 bigint      NOT NULL REFERENCES allocation_configs(id) ON DELETE CASCADE,
  allocation_id             bigint      REFERENCES channel_allocations(id) ON DELETE SET NULL,
  source_allocation_id      bigint      REFERENCES channel_allocations(id) ON DELETE SET NULL,
  destination_allocation_id bigint      REFERENCES channel_allocations(id) ON DELETE SET NULL,
  event_type                text        NOT NULL,
  quantity                  integer     NOT NULL,
  actor                     text        NOT NULL,
  reason                    text,
  token                     uuid,
  metadata                  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX slot_movements_config_idx ON slot_movements (config_id, id);
```

- [ ] **Step 2: Write the pool and migration runner**

`apps/api/src/db/pool.ts`:

```typescript
import { Pool } from 'pg';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://slot:slot@localhost:55432/slot_allocation';

export function createPool(): Pool {
  return new Pool({ connectionString: DATABASE_URL, max: 20 });
}
```

`apps/api/src/db/migrate.ts`:

```typescript
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
```

- [ ] **Step 3: Run the migration**

Run: `pnpm --filter @slot/api db:migrate`
Expected: `applied 0000_init.sql`.

- [ ] **Step 4: Verify the per-row constraint actually bites**

Run:

```bash
docker compose exec -T db psql -U slot -d slot_allocation -c \
  "INSERT INTO vessels (name) VALUES ('t');
   INSERT INTO cabins (vessel_id,name,capacity) VALUES (1,'c',10);
   INSERT INTO voyages (vessel_id,departure_port,departs_at,booking_cutoff_at)
     VALUES (1,'p',now(),now());
   INSERT INTO allocation_configs (voyage_id,cabin_id,cabin_capacity) VALUES (1,1,10);
   INSERT INTO channel_allocations (config_id,channel,allocation_type,allocated_slots,sold_slots)
     VALUES (1,'online','direct',5,9);"
```

Expected: `ERROR:  new row for relation "channel_allocations" violates check constraint "row_not_overcommitted"`.

Then clean up: `docker compose exec -T db psql -U slot -d slot_allocation -c "TRUNCATE vessels CASCADE;"`

- [ ] **Step 5: Commit**

```bash
git add apps/api/drizzle apps/api/src/db
git commit -m "feat(api): add schema with per-row overcommit constraint"
```

---

### Task 3: Deferred pool-ceiling triggers

Deferred because a legitimate multi-row edit is transiently invalid mid-transaction and need only balance at `COMMIT`. An immediate constraint would reject valid edits depending on statement order.

**Files:**
- Create: `apps/api/drizzle/migrations/0001_pool_ceilings.sql`
- Create: `apps/api/src/db/constraints.test.ts`
- Create: `apps/api/src/db/test-helpers.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/db/test-helpers.ts`:

```typescript
import type { Pool } from 'pg';
import { createPool } from './pool.js';

export function testPool(): Pool {
  return createPool();
}

export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE slot_movements, booking_slot_links, slot_holds,
             channel_allocations, allocation_configs, voyages, cabins, vessels, owners
    RESTART IDENTITY CASCADE
  `);
}

export interface SeededConfig {
  configId: number;
  cabinCapacity: number;
}

/** Creates one vessel, cabin, voyage, and empty config. */
export async function seedConfig(pool: Pool, capacity = 100): Promise<SeededConfig> {
  const { rows } = await pool.query<{ id: string }>(
    `WITH v AS (INSERT INTO vessels (name) VALUES ('MV Test') RETURNING id),
          c AS (INSERT INTO cabins (vessel_id, name, capacity)
                SELECT id, 'Economy', $1 FROM v RETURNING id, vessel_id),
          t AS (INSERT INTO voyages (vessel_id, departure_port, departs_at, booking_cutoff_at)
                SELECT vessel_id, 'Port A', now() + interval '2 days', now() + interval '1 day'
                FROM c RETURNING id)
     INSERT INTO allocation_configs (voyage_id, cabin_id, cabin_capacity)
     SELECT t.id, c.id, $1 FROM t, c RETURNING id`,
    [capacity],
  );
  return { configId: Number(rows[0]!.id), cabinCapacity: capacity };
}

export async function addRow(
  pool: Pool,
  configId: number,
  row: {
    channel: string;
    allocationType: string;
    allocatedSlots: number;
    ownerId?: number | null;
    fundingSource?: string;
    soldSlots?: number;
    heldSlots?: number;
  },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO channel_allocations
       (config_id, channel, owner_id, allocation_type, funding_source,
        allocated_slots, sold_slots, held_slots)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      configId,
      row.channel,
      row.ownerId ?? null,
      row.allocationType,
      row.fundingSource ?? 'online',
      row.allocatedSlots,
      row.soldSlots ?? 0,
      row.heldSlots ?? 0,
    ],
  );
  return Number(rows[0]!.id);
}

export async function addOwner(pool: Pool, name: string, isHidden = false): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO owners (name, is_hidden) VALUES ($1,$2) RETURNING id',
    [name, isHidden],
  );
  return Number(rows[0]!.id);
}
```

`apps/api/src/db/constraints.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { testPool, resetDatabase, seedConfig, addRow, addOwner } from './test-helpers.js';

let pool: Pool;

beforeAll(() => {
  pool = testPool();
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('pool ceiling constraints', () => {
  it('rejects online children exceeding the online parent', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Agency Seven');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 10 });
    await expect(
      addRow(pool, configId, {
        channel: 'agency',
        ownerId,
        allocationType: 'flexible',
        allocatedSlots: 30,
      }),
    ).rejects.toThrow(/online-funded children/);
  });

  it('rejects partner children exceeding the pool', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Managed Nine');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 50 });
    await addRow(pool, configId, {
      channel: 'partner_pool',
      allocationType: 'flexible',
      allocatedSlots: 10,
    });
    await expect(
      addRow(pool, configId, {
        channel: 'agency',
        ownerId,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: 25,
      }),
    ).rejects.toThrow(/partner-funded children/);
  });

  it('permits a transiently invalid edit that balances by commit', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Agency Seven');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 40 });
    const childId = await addRow(pool, configId, {
      channel: 'agency',
      ownerId,
      allocationType: 'flexible',
      allocatedSlots: 30,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Transiently 60 > 40. An immediate constraint would reject this here.
      await client.query('UPDATE channel_allocations SET allocated_slots = 60 WHERE id = $1', [
        childId,
      ]);
      await client.query(
        `UPDATE channel_allocations SET allocated_slots = 70
          WHERE config_id = $1 AND channel = 'online'`,
        [configId],
      );
      await expect(client.query('COMMIT')).resolves.toBeDefined();
    } finally {
      client.release();
    }
  });

  it('stops applying the ceiling after cutoff', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Agency Seven');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 40 });
    await addRow(pool, configId, {
      channel: 'agency',
      ownerId,
      allocationType: 'guaranteed',
      allocatedSlots: 30,
    });
    await pool.query('UPDATE allocation_configs SET cutoff_applied_at = now() WHERE id = $1', [
      configId,
    ]);
    // The parent is legitimately drained to zero while the guaranteed child remains.
    await expect(
      pool.query(
        `UPDATE channel_allocations SET allocated_slots = 0
          WHERE config_id = $1 AND channel = 'online'`,
        [configId],
      ),
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @slot/api test src/db/constraints.test.ts`
Expected: FAIL — the first two tests do not throw, because no trigger exists yet.

- [ ] **Step 3: Write the migration**

`apps/api/drizzle/migrations/0001_pool_ceilings.sql`:

```sql
CREATE OR REPLACE FUNCTION assert_pool_ceilings() RETURNS trigger AS $$
DECLARE
  cfg_id          bigint;
  applied_at      timestamptz;
  online_parent   integer;
  online_children integer;
  online_committed integer;
  pool_parent     integer;
  pool_children   integer;
  pool_committed  integer;
BEGIN
  cfg_id := COALESCE(NEW.config_id, OLD.config_id);

  SELECT cutoff_applied_at INTO applied_at
    FROM allocation_configs WHERE id = cfg_id;

  -- The config may already be gone (ON DELETE CASCADE); nothing left to check.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- After cutoff the parent pool is legitimately drained while guaranteed
  -- children remain allocated, so the ceiling no longer holds by design.
  IF applied_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(allocated_slots), 0) INTO online_parent
    FROM channel_allocations
   WHERE config_id = cfg_id
     AND channel = 'online' AND owner_id IS NULL AND allocation_type = 'direct';

  SELECT COALESCE(SUM(allocated_slots), 0) INTO online_children
    FROM channel_allocations
   WHERE config_id = cfg_id
     AND allocation_type IN ('flexible','guaranteed')
     AND funding_source <> 'partner_pool';

  SELECT COALESCE(SUM(sold_slots + held_slots), 0) INTO online_committed
    FROM channel_allocations
   WHERE config_id = cfg_id
     AND channel = 'online' AND owner_id IS NULL AND allocation_type = 'direct';

  -- The parent's OWN committed seats draw on the same partition its children
  -- carve from, so they belong on the same side of the inequality. Comparing
  -- children against the parent's allocation alone admits a parent that has
  -- sold 60 of 100 while a child holds 50.
  IF online_children + online_committed > online_parent THEN
    RAISE EXCEPTION
      'online-funded children (%) plus parent committed (%) exceed online parent allocation (%) on config %',
      online_children, online_committed, online_parent, cfg_id;
  END IF;

  -- A child whose parent row is absent belongs to no physical partition at all.
  IF online_children > 0 AND NOT EXISTS (
    SELECT 1 FROM channel_allocations
     WHERE config_id = cfg_id
       AND channel = 'online' AND owner_id IS NULL AND allocation_type = 'direct'
  ) THEN
    RAISE EXCEPTION
      'online-funded children exist with no online parent row on config %', cfg_id;
  END IF;

  SELECT COALESCE(SUM(allocated_slots), 0) INTO pool_parent
    FROM channel_allocations
   WHERE config_id = cfg_id AND channel = 'partner_pool';

  SELECT COALESCE(SUM(allocated_slots), 0) INTO pool_children
    FROM channel_allocations
   WHERE config_id = cfg_id AND funding_source = 'partner_pool';

  SELECT COALESCE(SUM(sold_slots + held_slots), 0) INTO pool_committed
    FROM channel_allocations
   WHERE config_id = cfg_id AND channel = 'partner_pool';

  IF pool_children + pool_committed > pool_parent THEN
    RAISE EXCEPTION
      'partner-funded children (%) plus pool committed (%) exceed partner pool allocation (%) on config %',
      pool_children, pool_committed, pool_parent, cfg_id;
  END IF;

  IF pool_children > 0 AND NOT EXISTS (
    SELECT 1 FROM channel_allocations
     WHERE config_id = cfg_id AND channel = 'partner_pool'
  ) THEN
    RAISE EXCEPTION
      'partner-funded children exist with no partner pool row on config %', cfg_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- DEFERRABLE INITIALLY DEFERRED: checked once at COMMIT, so a multi-statement
-- edit may pass through a transiently invalid state.
CREATE CONSTRAINT TRIGGER channel_allocations_pool_ceilings
AFTER INSERT OR UPDATE OR DELETE ON channel_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_pool_ceilings();

-- Row identity. Without these, "the online row" is whichever row the query
-- returns first, and netting may apply to one while a duplicate is offered
-- un-netted; an owner with two rows has both netted out of the parent but only
-- the first offered back, stranding the rest where no channel can reach it.
CREATE UNIQUE INDEX one_online_parent_per_config
  ON channel_allocations (config_id)
  WHERE channel = 'online' AND owner_id IS NULL AND allocation_type = 'direct';

CREATE UNIQUE INDEX one_partner_pool_per_config
  ON channel_allocations (config_id)
  WHERE channel = 'partner_pool';

CREATE UNIQUE INDEX one_row_per_owner_channel_funding
  ON channel_allocations (config_id, channel, owner_id, funding_source)
  WHERE owner_id IS NOT NULL;
```

- [ ] **Step 4: Migrate and run the tests**

Run: `pnpm --filter @slot/api db:migrate`
Expected: `applied 0001_pool_ceilings.sql`.

Run: `pnpm --filter @slot/api test src/db/constraints.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/drizzle apps/api/src/db
git commit -m "feat(api): enforce pool ceilings with deferred constraint triggers"
```

---

### Task 4: Locking repository

**Files:**
- Create: `apps/api/src/allocation/allocation.repository.ts`
- Test: `apps/api/src/allocation/allocation.repository.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/allocation/allocation.repository.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { AllocationRepository } from './allocation.repository.js';
import { testPool, resetDatabase, seedConfig, addRow, addOwner } from '../db/test-helpers.js';

let pool: Pool;
let repo: AllocationRepository;

beforeAll(() => {
  pool = testPool();
  repo = new AllocationRepository(pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('AllocationRepository', () => {
  it('loads rows in engine shape, ordered by id', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Agency Seven');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 65 });
    await addRow(pool, configId, { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 });
    await addRow(pool, configId, {
      channel: 'agency',
      ownerId,
      allocationType: 'guaranteed',
      allocatedSlots: 10,
    });

    const loaded = await repo.withLockedConfig(configId, async (ctx) => ctx.rows);

    expect(loaded.map((r) => r.channel)).toEqual(['online', 'counter', 'agency']);
    expect(loaded[0]).toMatchObject({
      channel: 'online',
      ownerId: null,
      allocationType: 'direct',
      fundingSource: 'online',
      allocatedSlots: 65,
      soldSlots: 0,
      heldSlots: 0,
      ownerIsHidden: false,
    });
  });

  it('reports a hidden owner on the row', async () => {
    const { configId } = await seedConfig(pool);
    const ownerId = await addOwner(pool, 'Masked', true);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 65 });
    await addRow(pool, configId, {
      channel: 'agency',
      ownerId,
      allocationType: 'flexible',
      allocatedSlots: 10,
    });

    const loaded = await repo.withLockedConfig(configId, async (ctx) => ctx.rows);
    expect(loaded.find((r) => r.channel === 'agency')?.ownerIsHidden).toBe(true);
  });

  it('throws for an unknown config', async () => {
    await expect(repo.withLockedConfig(999_999, async () => null)).rejects.toThrow(
      'allocation config 999999 not found',
    );
  });

  it('rolls back every write when the callback throws', async () => {
    const { configId } = await seedConfig(pool);
    const rowId = await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 65,
    });

    await expect(
      repo.withLockedConfig(configId, async (ctx) => {
        await ctx.applyDelta(rowId, { heldDelta: 5 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const after = await repo.withLockedConfig(configId, async (ctx) => ctx.rows);
    expect(after[0]?.heldSlots).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @slot/api test src/allocation`
Expected: FAIL — cannot resolve `./allocation.repository.js`.

- [ ] **Step 3: Write the minimal implementation**

`apps/api/src/allocation/allocation.repository.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { AllocationRow } from '@slot/engine';

export interface ConfigContext {
  client: PoolClient;
  configId: number;
  cabinCapacity: number;
  cutoffAppliedAt: Date | null;
  rows: AllocationRow[];
  applyDelta(
    rowId: number,
    delta: { heldDelta?: number; soldDelta?: number; allocatedDelta?: number },
  ): Promise<void>;
}

interface DbRow {
  id: string;
  channel: AllocationRow['channel'];
  owner_id: string | null;
  allocation_type: AllocationRow['allocationType'];
  funding_source: AllocationRow['fundingSource'];
  allocated_slots: number;
  sold_slots: number;
  held_slots: number;
  owner_is_hidden: boolean | null;
}

function toEngineRow(r: DbRow): AllocationRow {
  return {
    id: Number(r.id),
    channel: r.channel,
    ownerId: r.owner_id === null ? null : Number(r.owner_id),
    allocationType: r.allocation_type,
    fundingSource: r.funding_source,
    allocatedSlots: r.allocated_slots,
    soldSlots: r.sold_slots,
    heldSlots: r.held_slots,
    ownerIsHidden: r.owner_is_hidden ?? false,
  };
}

@Injectable()
export class AllocationRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Run `fn` inside one transaction with the config and all of its allocation
   * rows locked.
   *
   * The config row is locked first, which serializes concurrent writers on one
   * config. The allocation rows are then locked `ORDER BY id`, giving every
   * transaction the same acquisition order and removing the deadlock that
   * arbitrary ordering would produce between overlapping requests.
   */
  async withLockedConfig<T>(configId: number, fn: (ctx: ConfigContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const config = await client.query<{
        id: string;
        cabin_capacity: number;
        cutoff_applied_at: Date | null;
      }>(
        `SELECT id, cabin_capacity, cutoff_applied_at
           FROM allocation_configs WHERE id = $1 FOR UPDATE`,
        [configId],
      );
      if (config.rowCount === 0) {
        throw new Error(`allocation config ${configId} not found`);
      }

      const rows = await client.query<DbRow>(
        `SELECT a.id, a.channel, a.owner_id, a.allocation_type, a.funding_source,
                a.allocated_slots, a.sold_slots, a.held_slots, o.is_hidden AS owner_is_hidden
           FROM channel_allocations a
           LEFT JOIN owners o ON o.id = a.owner_id
          WHERE a.config_id = $1
          ORDER BY a.id
            FOR UPDATE OF a`,
        [configId],
      );

      const ctx: ConfigContext = {
        client,
        configId,
        cabinCapacity: config.rows[0]!.cabin_capacity,
        cutoffAppliedAt: config.rows[0]!.cutoff_applied_at,
        rows: rows.rows.map(toEngineRow),
        applyDelta: async (rowId, delta) => {
          await client.query(
            `UPDATE channel_allocations
                SET held_slots      = held_slots      + $2,
                    sold_slots      = sold_slots      + $3,
                    allocated_slots = allocated_slots + $4
              WHERE id = $1`,
            [rowId, delta.heldDelta ?? 0, delta.soldDelta ?? 0, delta.allocatedDelta ?? 0],
          );
        },
      };

      const result = await fn(ctx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
```

`FOR UPDATE OF a` is required: the `LEFT JOIN owners` would otherwise make PostgreSQL try to lock owner rows too, blocking unrelated configs that share an owner.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @slot/api test src/allocation`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/allocation
git commit -m "feat(api): add transactional repository with deterministic lock order"
```

---

### Task 5: Ledger service

**Files:**
- Create: `apps/api/src/ledger/ledger.service.ts`
- Test: `apps/api/src/ledger/ledger.service.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/ledger/ledger.service.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { LedgerService } from './ledger.service.js';
import { testPool, resetDatabase, seedConfig, addRow } from '../db/test-helpers.js';

let pool: Pool;
let ledger: LedgerService;

beforeAll(() => {
  pool = testPool();
  ledger = new LedgerService(pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('LedgerService', () => {
  it('appends a movement and reads it back newest first', async () => {
    const { configId } = await seedConfig(pool);
    const rowId = await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 10,
    });
    const client = await pool.connect();
    try {
      await ledger.record(client, {
        configId,
        allocationId: rowId,
        eventType: 'reserve',
        quantity: 3,
        actor: 'test',
        reason: 'unit test',
      });
    } finally {
      client.release();
    }

    const entries = await ledger.forConfig(configId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      eventType: 'reserve',
      quantity: 3,
      actor: 'test',
      allocationId: rowId,
    });
  });

  it('returns an empty list for a config with no movements', async () => {
    const { configId } = await seedConfig(pool);
    expect(await ledger.forConfig(configId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @slot/api test src/ledger`
Expected: FAIL — cannot resolve `./ledger.service.js`.

- [ ] **Step 3: Write the minimal implementation**

`apps/api/src/ledger/ledger.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

export type LedgerEventType =
  | 'reserve'
  | 'confirm_sale'
  | 'release_hold'
  | 'expire_hold'
  | 'release_sale'
  | 'cutoff_merge'
  | 'config_init';

export interface MovementInput {
  configId: number;
  allocationId?: number | null;
  sourceAllocationId?: number | null;
  destinationAllocationId?: number | null;
  eventType: LedgerEventType;
  quantity: number;
  actor: string;
  reason?: string | null;
  token?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LedgerEntry {
  id: number;
  allocationId: number | null;
  sourceAllocationId: number | null;
  destinationAllocationId: number | null;
  eventType: string;
  quantity: number;
  actor: string;
  reason: string | null;
  token: string | null;
  createdAt: Date;
}

/**
 * Append-only movement log. Every capacity change writes here inside the same
 * transaction that changed it, so the ledger can never disagree with the
 * counters it explains.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly pool: Pool) {}

  async record(client: PoolClient, input: MovementInput): Promise<void> {
    await client.query(
      `INSERT INTO slot_movements
         (config_id, allocation_id, source_allocation_id, destination_allocation_id,
          event_type, quantity, actor, reason, token, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.configId,
        input.allocationId ?? null,
        input.sourceAllocationId ?? null,
        input.destinationAllocationId ?? null,
        input.eventType,
        input.quantity,
        input.actor,
        input.reason ?? null,
        input.token ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async forConfig(configId: number, limit = 200): Promise<LedgerEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT id, allocation_id, source_allocation_id, destination_allocation_id,
              event_type, quantity, actor, reason, token, created_at
         FROM slot_movements WHERE config_id = $1
        ORDER BY id DESC LIMIT $2`,
      [configId, limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      allocationId: r.allocation_id === null ? null : Number(r.allocation_id),
      sourceAllocationId: r.source_allocation_id === null ? null : Number(r.source_allocation_id),
      destinationAllocationId:
        r.destination_allocation_id === null ? null : Number(r.destination_allocation_id),
      eventType: r.event_type,
      quantity: r.quantity,
      actor: r.actor,
      reason: r.reason,
      token: r.token,
      createdAt: r.created_at,
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @slot/api test src/ledger`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ledger
git commit -m "feat(api): add append-only movement ledger"
```

---

### Task 6: Reserve — create a hold

**Files:**
- Create: `apps/api/src/reservation/reservation.service.ts`
- Create: `apps/api/src/reservation/errors.ts`
- Test: `apps/api/src/reservation/reserve.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/reservation/reserve.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { ReservationService } from './reservation.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InsufficientCapacityError } from './errors.js';
import { testPool, resetDatabase, seedConfig, addRow, addOwner } from '../db/test-helpers.js';

let pool: Pool;
let service: ReservationService;

beforeAll(() => {
  pool = testPool();
  service = new ReservationService(new AllocationRepository(pool), new LedgerService(pool), pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

async function tree(): Promise<{ configId: number; ids: Record<string, number> }> {
  const { configId } = await seedConfig(pool, 100);
  const ordinary = await addOwner(pool, 'Agency Seven');
  const managedOwner = await addOwner(pool, 'Managed Nine');
  const ids = {
    counter: await addRow(pool, configId, {
      channel: 'counter',
      allocationType: 'direct',
      allocatedSlots: 20,
    }),
    online: await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 80,
    }),
    pool: await addRow(pool, configId, {
      channel: 'partner_pool',
      allocationType: 'flexible',
      allocatedSlots: 20,
    }),
    agency: await addRow(pool, configId, {
      channel: 'agency',
      ownerId: ordinary,
      allocationType: 'guaranteed',
      allocatedSlots: 10,
    }),
    managed: await addRow(pool, configId, {
      channel: 'agency',
      ownerId: managedOwner,
      allocationType: 'guaranteed',
      fundingSource: 'partner_pool',
      allocatedSlots: 8,
    }),
    ordinaryOwnerId: ordinary,
    managedOwnerId: managedOwner,
  };
  return { configId, ids };
}

describe('ReservationService.reserve', () => {
  it('holds seats on the requester own row', async () => {
    const { configId, ids } = await tree();
    const result = await service.reserve({
      configId,
      identity: { kind: 'owner', channel: 'agency', ownerId: ids.ordinaryOwnerId, managed: false },
      quantity: 4,
      actor: 'test',
    });

    expect(result.splits).toEqual([{ rowId: ids.agency, step: 'primary', quantity: 4 }]);
    const { rows } = await pool.query('SELECT held_slots FROM channel_allocations WHERE id = $1', [
      ids.agency,
    ]);
    expect(rows[0].held_slots).toBe(4);
  });

  it('splits across own row, pool, then online for a managed owner', async () => {
    const { configId, ids } = await tree();
    const result = await service.reserve({
      configId,
      identity: { kind: 'owner', channel: 'agency', ownerId: ids.managedOwnerId, managed: true },
      quantity: 25,
      actor: 'test',
    });

    expect(result.splits).toEqual([
      { rowId: ids.managed, step: 'primary', quantity: 8 },
      { rowId: ids.pool, step: 'partner_pool', quantity: 12 },
      { rowId: ids.online, step: 'online_remainder', quantity: 5 },
    ]);
  });

  it('writes one ledger entry per split', async () => {
    const { configId, ids } = await tree();
    await service.reserve({
      configId,
      identity: { kind: 'owner', channel: 'agency', ownerId: ids.managedOwnerId, managed: true },
      quantity: 25,
      actor: 'test',
    });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM slot_movements
        WHERE config_id = $1 AND event_type = 'reserve'`,
      [configId],
    );
    expect(rows[0].n).toBe(3);
  });

  it('refuses to spill counter into any other pool', async () => {
    const { configId } = await tree();
    await expect(
      service.reserve({ configId, identity: { kind: 'counter' }, quantity: 25, actor: 'test' }),
    ).rejects.toBeInstanceOf(InsufficientCapacityError);
  });

  it('reports available capacity on shortfall', async () => {
    const { configId } = await tree();
    await expect(
      service.reserve({ configId, identity: { kind: 'counter' }, quantity: 25, actor: 'test' }),
    ).rejects.toMatchObject({ requested: 25, available: 20, shortfall: 5 });
  });

  it('leaves no held seats behind when it fails', async () => {
    const { configId, ids } = await tree();
    await expect(
      service.reserve({ configId, identity: { kind: 'counter' }, quantity: 25, actor: 'test' }),
    ).rejects.toThrow();
    const { rows } = await pool.query('SELECT held_slots FROM channel_allocations WHERE id = $1', [
      ids.counter,
    ]);
    expect(rows[0].held_slots).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @slot/api test src/reservation`
Expected: FAIL — cannot resolve `./reservation.service.js`.

- [ ] **Step 3: Write the errors**

`apps/api/src/reservation/errors.ts`:

```typescript
/** A shortfall is an expected outcome, not a crash: it carries the numbers. */
export class InsufficientCapacityError extends Error {
  constructor(
    readonly requested: number,
    readonly available: number,
    readonly shortfall: number,
  ) {
    super(`requested ${requested} seats but only ${available} are available`);
    this.name = 'InsufficientCapacityError';
  }
}

export class ReservationNotFoundError extends Error {
  constructor(token: string) {
    super(`reservation ${token} not found`);
    this.name = 'ReservationNotFoundError';
  }
}

export class ReservationNotOpenError extends Error {
  constructor(
    token: string,
    readonly status: string,
  ) {
    super(`reservation ${token} is ${status} and can no longer be modified`);
    this.name = 'ReservationNotOpenError';
  }
}
```

- [ ] **Step 4: Write the service**

`apps/api/src/reservation/reservation.service.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  planConsumption,
  selectCandidates,
  type RequesterIdentity,
  type Split,
  type WaterfallTrace,
} from '@slot/engine';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InsufficientCapacityError } from './errors.js';

export interface ReserveInput {
  configId: number;
  identity: RequesterIdentity;
  quantity: number;
  actor: string;
}

export interface ReserveResult {
  token: string;
  expiresAt: Date;
  splits: Split[];
  trace: WaterfallTrace;
}

const HOLD_TTL_SECONDS = Number(process.env.HOLD_TTL_SECONDS ?? 600);

@Injectable()
export class ReservationService {
  constructor(
    private readonly repo: AllocationRepository,
    private readonly ledger: LedgerService,
    private readonly pool: Pool,
  ) {}

  /**
   * Hold seats for `identity`. The engine decides which rows and how much; this
   * method only persists that decision inside the locked transaction.
   */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    return this.repo.withLockedConfig(input.configId, async (ctx) => {
      const trace = selectCandidates(ctx.rows, input.identity);
      const plan = planConsumption(trace, input.quantity);

      if (!plan.ok) {
        throw new InsufficientCapacityError(plan.requested, plan.available, plan.shortfall);
      }

      const token = randomUUID();
      const expiresAt = new Date(Date.now() + HOLD_TTL_SECONDS * 1000);

      for (const split of plan.splits) {
        await ctx.applyDelta(split.rowId, { heldDelta: split.quantity });
        await ctx.client.query(
          `INSERT INTO slot_holds (token, config_id, allocation_id, quantity, expires_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [token, input.configId, split.rowId, split.quantity, expiresAt],
        );
        await this.ledger.record(ctx.client, {
          configId: input.configId,
          allocationId: split.rowId,
          eventType: 'reserve',
          quantity: split.quantity,
          actor: input.actor,
          token,
          reason: `waterfall step: ${split.step}`,
        });
      }

      return { token, expiresAt, splits: plan.splits, trace };
    });
  }

  /** Read-only waterfall preview. Takes no locks and changes nothing. */
  async preview(configId: number, identity: RequesterIdentity): Promise<WaterfallTrace> {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.channel, a.owner_id, a.allocation_type, a.funding_source,
              a.allocated_slots, a.sold_slots, a.held_slots, o.is_hidden AS owner_is_hidden
         FROM channel_allocations a
         LEFT JOIN owners o ON o.id = a.owner_id
        WHERE a.config_id = $1 ORDER BY a.id`,
      [configId],
    );
    return selectCandidates(
      rows.map((r) => ({
        id: Number(r.id),
        channel: r.channel,
        ownerId: r.owner_id === null ? null : Number(r.owner_id),
        allocationType: r.allocation_type,
        fundingSource: r.funding_source,
        allocatedSlots: r.allocated_slots,
        soldSlots: r.sold_slots,
        heldSlots: r.held_slots,
        ownerIsHidden: r.owner_is_hidden ?? false,
      })),
      identity,
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @slot/api test src/reservation`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reservation
git commit -m "feat(api): reserve seats through the waterfall with per-split holds"
```

---

### Task 7: Confirm and release

**Files:**
- Modify: `apps/api/src/reservation/reservation.service.ts`
- Test: `apps/api/src/reservation/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/reservation/lifecycle.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { ReservationService } from './reservation.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ReservationNotFoundError, ReservationNotOpenError } from './errors.js';
import { testPool, resetDatabase, seedConfig, addRow } from '../db/test-helpers.js';

let pool: Pool;
let service: ReservationService;

beforeAll(() => {
  pool = testPool();
  service = new ReservationService(new AllocationRepository(pool), new LedgerService(pool), pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

async function simpleConfig(): Promise<{ configId: number; onlineId: number }> {
  const { configId } = await seedConfig(pool, 50);
  const onlineId = await addRow(pool, configId, {
    channel: 'online',
    allocationType: 'direct',
    allocatedSlots: 50,
  });
  return { configId, onlineId };
}

describe('confirm', () => {
  it('moves held seats to sold and writes a durable link', async () => {
    const { configId, onlineId } = await simpleConfig();
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 4,
      actor: 'test',
    });

    await service.confirm(token, 'BK-1', 'test');

    const { rows } = await pool.query(
      'SELECT sold_slots, held_slots FROM channel_allocations WHERE id = $1',
      [onlineId],
    );
    expect(rows[0]).toMatchObject({ sold_slots: 4, held_slots: 0 });

    const links = await pool.query(
      'SELECT allocation_id, quantity FROM booking_slot_links WHERE booking_ref = $1',
      ['BK-1'],
    );
    expect(links.rows).toEqual([{ allocation_id: String(onlineId), quantity: 4 }]);
  });

  it('is idempotent when every row is already confirmed', async () => {
    const { configId } = await simpleConfig();
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 4,
      actor: 'test',
    });
    await service.confirm(token, 'BK-1', 'test');
    await expect(service.confirm(token, 'BK-1', 'test')).resolves.toMatchObject({
      alreadyConfirmed: true,
    });
    const { rows } = await pool.query('SELECT sold_slots FROM channel_allocations');
    expect(rows[0].sold_slots).toBe(4);
  });

  it('rejects an unknown token', async () => {
    await expect(
      service.confirm('00000000-0000-0000-0000-000000000000', 'BK-1', 'test'),
    ).rejects.toBeInstanceOf(ReservationNotFoundError);
  });
});

describe('release', () => {
  it('returns held seats to the exact source rows', async () => {
    const { configId, onlineId } = await simpleConfig();
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 4,
      actor: 'test',
    });

    await service.release(token, 'test');

    const { rows } = await pool.query('SELECT held_slots FROM channel_allocations WHERE id = $1', [
      onlineId,
    ]);
    expect(rows[0].held_slots).toBe(0);
  });

  it('refuses to release a confirmed reservation', async () => {
    const { configId } = await simpleConfig();
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 4,
      actor: 'test',
    });
    await service.confirm(token, 'BK-1', 'test');
    await expect(service.release(token, 'test')).rejects.toBeInstanceOf(ReservationNotOpenError);
  });

  it('never increases sales through a released token', async () => {
    const { configId } = await simpleConfig();
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 4,
      actor: 'test',
    });
    await service.release(token, 'test');
    await expect(service.confirm(token, 'BK-1', 'test')).rejects.toBeInstanceOf(
      ReservationNotOpenError,
    );
    const { rows } = await pool.query('SELECT sold_slots FROM channel_allocations');
    expect(rows[0].sold_slots).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @slot/api test src/reservation/lifecycle.test.ts`
Expected: FAIL — `service.confirm is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to the `ReservationService` class in `apps/api/src/reservation/reservation.service.ts`:

```typescript
  /**
   * Confirm every split under `token` in one transaction: held decreases, sold
   * increases, and a durable link records exactly which row each seat came from.
   *
   * The link — not the booking's declared channel — is what a later release
   * reads, which is the only correct answer when the waterfall drew from
   * several rows.
   */
  async confirm(
    token: string,
    bookingRef: string,
    actor: string,
  ): Promise<{ alreadyConfirmed: boolean; splits: Split[] }> {
    const configId = await this.configIdForToken(token);
    return this.repo.withLockedConfig(configId, async (ctx) => {
      const holds = await ctx.client.query<{
        id: string;
        allocation_id: string;
        quantity: number;
        status: string;
      }>(
        `SELECT id, allocation_id, quantity, status FROM slot_holds
          WHERE token = $1 ORDER BY id FOR UPDATE`,
        [token],
      );

      if (holds.rows.every((h) => h.status === 'confirmed')) {
        return {
          alreadyConfirmed: true,
          splits: holds.rows.map((h) => ({
            rowId: Number(h.allocation_id),
            step: 'primary' as const,
            quantity: h.quantity,
          })),
        };
      }

      const notOpen = holds.rows.find((h) => h.status !== 'open');
      if (notOpen) throw new ReservationNotOpenError(token, notOpen.status);

      const splits: Split[] = [];
      for (const hold of holds.rows) {
        const allocationId = Number(hold.allocation_id);
        await ctx.applyDelta(allocationId, {
          heldDelta: -hold.quantity,
          soldDelta: hold.quantity,
        });
        await ctx.client.query(`UPDATE slot_holds SET status = 'confirmed' WHERE id = $1`, [
          hold.id,
        ]);
        await ctx.client.query(
          `INSERT INTO booking_slot_links (booking_ref, config_id, allocation_id, quantity)
           VALUES ($1,$2,$3,$4)`,
          [bookingRef, configId, allocationId, hold.quantity],
        );
        await this.ledger.record(ctx.client, {
          configId,
          allocationId,
          eventType: 'confirm_sale',
          quantity: hold.quantity,
          actor,
          token,
          reason: `booking ${bookingRef}`,
        });
        splits.push({ rowId: allocationId, step: 'primary', quantity: hold.quantity });
      }
      return { alreadyConfirmed: false, splits };
    });
  }

  /** Return an open hold's seats to the exact rows they were taken from. */
  async release(token: string, actor: string): Promise<void> {
    const configId = await this.configIdForToken(token);
    await this.repo.withLockedConfig(configId, async (ctx) => {
      const holds = await ctx.client.query<{
        id: string;
        allocation_id: string;
        quantity: number;
        status: string;
      }>(
        `SELECT id, allocation_id, quantity, status FROM slot_holds
          WHERE token = $1 ORDER BY id FOR UPDATE`,
        [token],
      );

      const notOpen = holds.rows.find((h) => h.status !== 'open');
      if (notOpen) throw new ReservationNotOpenError(token, notOpen.status);

      for (const hold of holds.rows) {
        const allocationId = Number(hold.allocation_id);
        await ctx.applyDelta(allocationId, { heldDelta: -hold.quantity });
        await ctx.client.query(`UPDATE slot_holds SET status = 'released' WHERE id = $1`, [hold.id]);
        await this.ledger.record(ctx.client, {
          configId,
          allocationId,
          eventType: 'release_hold',
          quantity: hold.quantity,
          actor,
          token,
        });
      }
    });
  }

  private async configIdForToken(token: string): Promise<number> {
    const { rows } = await this.pool.query<{ config_id: string }>(
      'SELECT config_id FROM slot_holds WHERE token = $1 LIMIT 1',
      [token],
    );
    if (rows.length === 0) throw new ReservationNotFoundError(token);
    return Number(rows[0]!.config_id);
  }
```

Extend the imports at the top of the file to `import { InsufficientCapacityError, ReservationNotFoundError, ReservationNotOpenError } from './errors.js';`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @slot/api test src/reservation`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reservation
git commit -m "feat(api): confirm holds into durable booking links, and release them"
```

---

### Task 8: TTL expiry sweeper

**Files:**
- Create: `apps/api/src/reservation/expiry.service.ts`
- Test: `apps/api/src/reservation/expiry.service.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/reservation/expiry.service.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { ExpiryService } from './expiry.service.js';
import { ReservationService } from './reservation.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { testPool, resetDatabase, seedConfig, addRow } from '../db/test-helpers.js';

let pool: Pool;
let service: ReservationService;
let expiry: ExpiryService;

beforeAll(() => {
  pool = testPool();
  const repo = new AllocationRepository(pool);
  const ledger = new LedgerService(pool);
  service = new ReservationService(repo, ledger, pool);
  expiry = new ExpiryService(repo, ledger, pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('ExpiryService.sweep', () => {
  it('returns seats from an expired hold', async () => {
    const { configId } = await seedConfig(pool, 50);
    const onlineId = await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 50,
    });
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 6,
      actor: 'test',
    });
    await pool.query(`UPDATE slot_holds SET expires_at = now() - interval '1 minute' WHERE token = $1`, [token]);

    const swept = await expiry.sweep();

    expect(swept).toBe(1);
    const { rows } = await pool.query('SELECT held_slots FROM channel_allocations WHERE id = $1', [
      onlineId,
    ]);
    expect(rows[0].held_slots).toBe(0);
    const status = await pool.query('SELECT status FROM slot_holds WHERE token = $1', [token]);
    expect(status.rows[0].status).toBe('expired');
  });

  it('leaves unexpired holds alone', async () => {
    const { configId } = await seedConfig(pool, 50);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 50 });
    await service.reserve({ configId, identity: { kind: 'online' }, quantity: 6, actor: 'test' });
    expect(await expiry.sweep()).toBe(0);
  });

  it('does not touch confirmed holds even when past expiry', async () => {
    const { configId } = await seedConfig(pool, 50);
    const onlineId = await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 50,
    });
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 6,
      actor: 'test',
    });
    await service.confirm(token, 'BK-1', 'test');
    await pool.query(`UPDATE slot_holds SET expires_at = now() - interval '1 minute' WHERE token = $1`, [token]);

    expect(await expiry.sweep()).toBe(0);
    const { rows } = await pool.query('SELECT sold_slots FROM channel_allocations WHERE id = $1', [
      onlineId,
    ]);
    expect(rows[0].sold_slots).toBe(6);
  });

  it('writes an expire_hold ledger entry', async () => {
    const { configId } = await seedConfig(pool, 50);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 50 });
    const { token } = await service.reserve({
      configId,
      identity: { kind: 'online' },
      quantity: 6,
      actor: 'test',
    });
    await pool.query(`UPDATE slot_holds SET expires_at = now() - interval '1 minute' WHERE token = $1`, [token]);
    await expiry.sweep();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM slot_movements WHERE event_type = 'expire_hold'`,
    );
    expect(rows[0].n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @slot/api test src/reservation/expiry.service.test.ts`
Expected: FAIL — cannot resolve `./expiry.service.js`.

- [ ] **Step 3: Write the minimal implementation**

`apps/api/src/reservation/expiry.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Pool } from 'pg';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';

/**
 * Returns seats from holds whose TTL has passed.
 *
 * A sweeper rather than lazy expiry-on-read (ADR-0010): expired seats must
 * become visible to every reader, not only to whoever happens to touch that row
 * next. A trip nobody queries would otherwise strand its capacity indefinitely.
 */
@Injectable()
export class ExpiryService {
  private readonly logger = new Logger(ExpiryService.name);

  constructor(
    private readonly repo: AllocationRepository,
    private readonly ledger: LedgerService,
    private readonly pool: Pool,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async scheduledSweep(): Promise<void> {
    const count = await this.sweep();
    if (count > 0) this.logger.log(`expired ${count} reservation(s)`);
  }

  /** Returns the number of reservation tokens expired. */
  async sweep(): Promise<number> {
    const { rows } = await this.pool.query<{ token: string; config_id: string }>(
      `SELECT DISTINCT token, config_id FROM slot_holds
        WHERE status = 'open' AND expires_at <= now()`,
    );

    let expired = 0;
    for (const { token, config_id } of rows) {
      await this.repo.withLockedConfig(Number(config_id), async (ctx) => {
        // Re-read under the lock: the token may have been confirmed or released
        // between the scan above and acquiring this lock.
        const holds = await ctx.client.query<{
          id: string;
          allocation_id: string;
          quantity: number;
        }>(
          `SELECT id, allocation_id, quantity FROM slot_holds
            WHERE token = $1 AND status = 'open' AND expires_at <= now()
            ORDER BY id FOR UPDATE`,
          [token],
        );
        if (holds.rowCount === 0) return;

        for (const hold of holds.rows) {
          const allocationId = Number(hold.allocation_id);
          await ctx.applyDelta(allocationId, { heldDelta: -hold.quantity });
          await ctx.client.query(`UPDATE slot_holds SET status = 'expired' WHERE id = $1`, [
            hold.id,
          ]);
          await this.ledger.record(ctx.client, {
            configId: ctx.configId,
            allocationId,
            eventType: 'expire_hold',
            quantity: hold.quantity,
            actor: 'system',
            token,
            reason: 'hold ttl elapsed',
          });
        }
        expired += 1;
      });
    }
    return expired;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @slot/api test src/reservation`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reservation/expiry.service.ts apps/api/src/reservation/expiry.service.test.ts
git commit -m "feat(api): expire stale holds and return their seats"
```

---

### Task 9: Cutoff release to counter

**Files:**
- Create: `apps/api/src/cutoff/cutoff.service.ts`
- Test: `apps/api/src/cutoff/cutoff.service.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/cutoff/cutoff.service.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { CutoffService } from './cutoff.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { testPool, resetDatabase, seedConfig, addRow, addOwner } from '../db/test-helpers.js';

let pool: Pool;
let cutoff: CutoffService;

beforeAll(() => {
  pool = testPool();
  cutoff = new CutoffService(new AllocationRepository(pool), new LedgerService(pool), pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

async function cutoffTree() {
  const { configId } = await seedConfig(pool, 100);
  const a = await addOwner(pool, 'Flexible Agency');
  const g = await addOwner(pool, 'Guaranteed Agency');
  const ids = {
    counter: await addRow(pool, configId, {
      channel: 'counter',
      allocationType: 'direct',
      allocatedSlots: 10,
    }),
    online: await addRow(pool, configId, {
      channel: 'online',
      allocationType: 'direct',
      allocatedSlots: 90,
      soldSlots: 5,
    }),
    flexible: await addRow(pool, configId, {
      channel: 'agency',
      ownerId: a,
      allocationType: 'flexible',
      allocatedSlots: 20,
      soldSlots: 3,
    }),
    guaranteed: await addRow(pool, configId, {
      channel: 'agency',
      ownerId: g,
      allocationType: 'guaranteed',
      allocatedSlots: 15,
      soldSlots: 2,
    }),
  };
  return { configId, ids };
}

describe('CutoffService.apply', () => {
  it('moves the free portion of flexible rows to counter', async () => {
    const { configId, ids } = await cutoffTree();
    await cutoff.apply(configId, 'test');
    const { rows } = await pool.query(
      'SELECT id, allocated_slots FROM channel_allocations WHERE config_id = $1 ORDER BY id',
      [configId],
    );
    const byId = Object.fromEntries(rows.map((r) => [Number(r.id), r.allocated_slots]));
    // flexible: 20 allocated, 3 sold -> 17 movable, leaving 3.
    expect(byId[ids.flexible]).toBe(3);
  });

  it('leaves guaranteed rows untouched', async () => {
    const { configId, ids } = await cutoffTree();
    await cutoff.apply(configId, 'test');
    const { rows } = await pool.query(
      'SELECT allocated_slots FROM channel_allocations WHERE id = $1',
      [ids.guaranteed],
    );
    expect(rows[0].allocated_slots).toBe(15);
  });

  it('accumulates every movable seat on the counter row', async () => {
    const { configId, ids } = await cutoffTree();
    await cutoff.apply(configId, 'test');
    const { rows } = await pool.query(
      'SELECT allocated_slots FROM channel_allocations WHERE id = $1',
      [ids.counter],
    );
    // 10 existing + online (90-5=85) + flexible (20-3=17) = 112.
    expect(rows[0].allocated_slots).toBe(112);
  });

  it('is idempotent', async () => {
    const { configId, ids } = await cutoffTree();
    await cutoff.apply(configId, 'test');
    await cutoff.apply(configId, 'test');
    const { rows } = await pool.query(
      'SELECT allocated_slots FROM channel_allocations WHERE id = $1',
      [ids.counter],
    );
    expect(rows[0].allocated_slots).toBe(112);
  });

  it('preserves sold seats on every row it drains', async () => {
    const { configId, ids } = await cutoffTree();
    await cutoff.apply(configId, 'test');
    const { rows } = await pool.query(
      'SELECT sold_slots, allocated_slots FROM channel_allocations WHERE id = $1',
      [ids.online],
    );
    expect(rows[0]).toMatchObject({ sold_slots: 5, allocated_slots: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @slot/api test src/cutoff`
Expected: FAIL — cannot resolve `./cutoff.service.js`.

- [ ] **Step 3: Write the minimal implementation**

`apps/api/src/cutoff/cutoff.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Pool } from 'pg';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';

/**
 * At the booking cutoff, unsold capacity that channels no longer need is
 * consolidated onto the counter so walk-up customers can buy it.
 *
 * `flexible` children and direct `online` / `marketplace` rows give up their
 * free portion. `guaranteed` children keep theirs — that is what the guarantee
 * means. Sold and held seats are never moved.
 */
@Injectable()
export class CutoffService {
  private readonly logger = new Logger(CutoffService.name);

  constructor(
    private readonly repo: AllocationRepository,
    private readonly ledger: LedgerService,
    private readonly pool: Pool,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledSweep(): Promise<void> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT c.id FROM allocation_configs c
         JOIN voyages v ON v.id = c.voyage_id
        WHERE c.cutoff_enabled AND c.cutoff_applied_at IS NULL
          AND v.booking_cutoff_at <= now()`,
    );
    for (const { id } of rows) {
      await this.apply(Number(id), 'system');
    }
    if (rows.length > 0) this.logger.log(`applied cutoff to ${rows.length} config(s)`);
  }

  async apply(configId: number, actor: string): Promise<void> {
    await this.repo.withLockedConfig(configId, async (ctx) => {
      // Re-checked under the lock so two concurrent sweeps cannot both apply.
      if (ctx.cutoffAppliedAt !== null) return;

      const counter =
        ctx.rows.find((r) => r.channel === 'counter' && r.allocationType === 'direct') ??
        (await this.createCounterRow(ctx.client, configId));

      let moved = 0;
      for (const row of ctx.rows) {
        if (row.id === counter.id) continue;
        const eligible =
          row.allocationType === 'flexible' ||
          (row.allocationType === 'direct' &&
            (row.channel === 'online' || row.channel === 'marketplace'));
        if (!eligible) continue;

        const movable = row.allocatedSlots - row.soldSlots - row.heldSlots;
        if (movable <= 0) continue;

        await ctx.applyDelta(row.id, { allocatedDelta: -movable });
        moved += movable;
        await this.ledger.record(ctx.client, {
          configId,
          allocationId: row.id,
          sourceAllocationId: row.id,
          destinationAllocationId: counter.id,
          eventType: 'cutoff_merge',
          quantity: movable,
          actor,
          reason: `released ${row.allocationType} ${row.channel} capacity to counter`,
        });
      }

      if (moved > 0) {
        await ctx.applyDelta(counter.id, { allocatedDelta: moved });
      }

      // Set last: the deferred pool-ceiling trigger reads this flag at COMMIT,
      // and after cutoff the parent is legitimately drained below its children.
      await ctx.client.query(
        'UPDATE allocation_configs SET cutoff_applied_at = now() WHERE id = $1',
        [configId],
      );
    });
  }

  private async createCounterRow(
    client: import('pg').PoolClient,
    configId: number,
  ): Promise<{ id: number }> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO channel_allocations
         (config_id, channel, allocation_type, funding_source, allocated_slots)
       VALUES ($1,'counter','direct','online',0) RETURNING id`,
      [configId],
    );
    return { id: Number(rows[0]!.id) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @slot/api test src/cutoff`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cutoff
git commit -m "feat(api): release unsold flexible and direct capacity at cutoff"
```

---

### Task 10: The concurrency proof

The test the README is built around.

**Files:**
- Create: `apps/api/src/reservation/oversell.concurrency.test.ts`

- [ ] **Step 1: Write the test**

`apps/api/src/reservation/oversell.concurrency.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { ReservationService } from './reservation.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InsufficientCapacityError } from './errors.js';
import { checkInvariants, type AllocationRow } from '@slot/engine';
import { testPool, resetDatabase, seedConfig, addRow, addOwner } from '../db/test-helpers.js';

let pool: Pool;
let service: ReservationService;

beforeAll(() => {
  pool = testPool();
  service = new ReservationService(new AllocationRepository(pool), new LedgerService(pool), pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

async function loadRows(configId: number): Promise<AllocationRow[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.channel, a.owner_id, a.allocation_type, a.funding_source,
            a.allocated_slots, a.sold_slots, a.held_slots, o.is_hidden AS owner_is_hidden
       FROM channel_allocations a LEFT JOIN owners o ON o.id = a.owner_id
      WHERE a.config_id = $1 ORDER BY a.id`,
    [configId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    channel: r.channel,
    ownerId: r.owner_id === null ? null : Number(r.owner_id),
    allocationType: r.allocation_type,
    fundingSource: r.funding_source,
    allocatedSlots: r.allocated_slots,
    soldSlots: r.sold_slots,
    heldSlots: r.held_slots,
    ownerIsHidden: r.owner_is_hidden ?? false,
  }));
}

describe('oversell under concurrency', () => {
  it('grants exactly the available seats when 50 requests race for 10', async () => {
    const { configId } = await seedConfig(pool, 10);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 10 });

    const attempts = Array.from({ length: 50 }, () =>
      service
        .reserve({ configId, identity: { kind: 'online' }, quantity: 1, actor: 'race' })
        .then(() => 'granted' as const)
        .catch((error: unknown) =>
          error instanceof InsufficientCapacityError ? ('refused' as const) : Promise.reject(error),
        ),
    );

    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'granted')).toHaveLength(10);
    expect(results.filter((r) => r === 'refused')).toHaveLength(40);

    const rows = await loadRows(configId);
    expect(rows[0]!.heldSlots).toBe(10);
    expect(checkInvariants(rows, 10)).toEqual([]);
  });

  it('keeps the ledger consistent with the counters under contention', async () => {
    const { configId } = await seedConfig(pool, 30);
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 30 });

    await Promise.all(
      Array.from({ length: 40 }, () =>
        service
          .reserve({ configId, identity: { kind: 'online' }, quantity: 2, actor: 'race' })
          .catch((error: unknown) => {
            if (!(error instanceof InsufficientCapacityError)) throw error;
          }),
      ),
    );

    const { rows: ledgerTotal } = await pool.query<{ total: string | null }>(
      `SELECT SUM(quantity)::text AS total FROM slot_movements
        WHERE config_id = $1 AND event_type = 'reserve'`,
      [configId],
    );
    const rows = await loadRows(configId);
    expect(Number(ledgerTotal[0]!.total ?? 0)).toBe(rows[0]!.heldSlots);
    expect(checkInvariants(rows, 30)).toEqual([]);
  });

  it('does not oversell when concurrent requests split across the tree', async () => {
    const { configId } = await seedConfig(pool, 40);
    const managedOwner = await addOwner(pool, 'Managed Nine');
    await addRow(pool, configId, { channel: 'online', allocationType: 'direct', allocatedSlots: 40 });
    await addRow(pool, configId, {
      channel: 'partner_pool',
      allocationType: 'flexible',
      allocatedSlots: 15,
    });
    await addRow(pool, configId, {
      channel: 'agency',
      ownerId: managedOwner,
      allocationType: 'guaranteed',
      fundingSource: 'partner_pool',
      allocatedSlots: 5,
    });

    const identity = {
      kind: 'owner' as const,
      channel: 'agency' as const,
      ownerId: managedOwner,
      managed: true,
    };
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        service
          .reserve({ configId, identity, quantity: 3, actor: 'race' })
          .then(() => 'granted' as const)
          .catch((error: unknown) =>
            error instanceof InsufficientCapacityError
              ? ('refused' as const)
              : Promise.reject(error),
          ),
      ),
    );

    const rows = await loadRows(configId);
    const totalHeld = rows.reduce((t, r) => t + r.heldSlots, 0);
    expect(totalHeld).toBe(results.filter((r) => r === 'granted').length * 3);
    // 5 own + 10 netted pool + 25 netted online = 40 physical seats.
    expect(totalHeld).toBeLessThanOrEqual(40);
    expect(checkInvariants(rows, 40)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @slot/api test src/reservation/oversell.concurrency.test.ts`
Expected: PASS — 3 tests. If any fails, do not weaken the test; the locking is wrong.

- [ ] **Step 3: Capture the output for the README**

Run: `pnpm --filter @slot/api test src/reservation/oversell.concurrency.test.ts 2>&1 | tee docs/evidence/concurrency-run.txt`

Create the directory first if needed: `mkdir -p docs/evidence`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/reservation/oversell.concurrency.test.ts docs/evidence
git commit -m "test(api): prove concurrent reservations cannot oversell"
```

---

### Task 11: HTTP surface and the untrusted boundary

The engine's `RequesterIdentity` makes an unresolved owner unrepresentable. This is where untrusted input either becomes a valid identity or is rejected.

**Files:**
- Create: `apps/api/src/http/dto.ts`
- Create: `apps/api/src/http/identity.ts`
- Create: `apps/api/src/http/allocation.controller.ts`
- Create: `apps/api/src/http/reservation.controller.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/main.ts`
- Test: `apps/api/src/http/identity.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/http/identity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { toIdentity } from './identity.js';

describe('toIdentity', () => {
  it('maps unowned channels', () => {
    expect(toIdentity({ channel: 'online' })).toEqual({ kind: 'online' });
    expect(toIdentity({ channel: 'counter' })).toEqual({ kind: 'counter' });
    expect(toIdentity({ channel: 'marketplace' })).toEqual({ kind: 'marketplace' });
  });

  it('maps an owned channel with a resolved owner', () => {
    expect(toIdentity({ channel: 'agency', ownerId: 7, managed: true })).toEqual({
      kind: 'owner',
      channel: 'agency',
      ownerId: 7,
      managed: true,
    });
  });

  it('hard-fails an owned channel with no owner', () => {
    expect(() => toIdentity({ channel: 'agency' })).toThrow(
      'agency requests require a resolved owner',
    );
  });

  it('hard-fails an owned channel with a null owner', () => {
    expect(() => toIdentity({ channel: 'reseller', ownerId: null })).toThrow(
      'reseller requests require a resolved owner',
    );
  });

  it('refuses partner_pool as a requester channel', () => {
    expect(() => toIdentity({ channel: 'partner_pool' })).toThrow(
      'partner_pool is not a bookable channel',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @slot/api test src/http`
Expected: FAIL — cannot resolve `./identity.js`.

- [ ] **Step 3: Write the boundary**

`apps/api/src/http/identity.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import type { RequesterIdentity } from '@slot/engine';

export interface IdentityInput {
  channel: string;
  ownerId?: number | null;
  managed?: boolean;
}

/**
 * Turn untrusted request fields into a `RequesterIdentity`, or reject them.
 *
 * An owned channel with no resolved owner MUST fail here. A null owner matches
 * the unowned online row, so letting it through would silently drain the
 * operator's pool under an agency's name — a data-integrity bug that looks
 * exactly like ordinary traffic in the logs.
 *
 * `partner_pool` is not a requester: it is a pool that eligible requesters draw
 * from. Accepting it as a channel would let a caller claim a privileged
 * topology by sending a string.
 */
export function toIdentity(input: IdentityInput): RequesterIdentity {
  const channel = input.channel.trim().toLowerCase();

  if (channel === 'partner_pool') {
    throw new BadRequestException('partner_pool is not a bookable channel');
  }
  if (channel === 'counter') return { kind: 'counter' };
  if (channel === 'online') return { kind: 'online' };
  if (channel === 'marketplace') return { kind: 'marketplace' };

  if (channel === 'agency' || channel === 'reseller') {
    if (input.ownerId === undefined || input.ownerId === null) {
      throw new BadRequestException(`${channel} requests require a resolved owner`);
    }
    return {
      kind: 'owner',
      channel,
      ownerId: input.ownerId,
      managed: input.managed === true,
    };
  }

  throw new BadRequestException(`unknown channel: ${input.channel}`);
}
```

- [ ] **Step 4: Write the DTOs and controllers**

`apps/api/src/http/dto.ts`:

```typescript
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class IdentityDto {
  @IsString() channel!: string;
  @IsOptional() @IsInt() ownerId?: number;
  @IsOptional() @IsBoolean() managed?: boolean;
}

export class ReserveDto extends IdentityDto {
  @IsInt() @Min(1) quantity!: number;
}

export class ConfirmDto {
  @IsString() bookingRef!: string;
}
```

`apps/api/src/http/allocation.controller.ts`:

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import type { Pool } from 'pg';
import { checkInvariants, rawAvailable, selectCandidates, sumAvailable } from '@slot/engine';
import { ReservationService } from '../reservation/reservation.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CutoffService } from '../cutoff/cutoff.service.js';
import { IdentityDto } from './dto.js';
import { toIdentity } from './identity.js';

@Controller('configs')
export class AllocationController {
  constructor(
    private readonly reservations: ReservationService,
    private readonly ledger: LedgerService,
    private readonly cutoff: CutoffService,
    private readonly pool: Pool,
  ) {}

  /** The tree, with raw and netted availability side by side. */
  @Get(':id')
  async tree(@Param('id', ParseIntPipe) id: number) {
    const rows = await this.reservations.rowsFor(id);
    const { rows: cfg } = await this.pool.query<{ cabin_capacity: number }>(
      'SELECT cabin_capacity FROM allocation_configs WHERE id = $1',
      [id],
    );
    const capacity = cfg[0]?.cabin_capacity ?? 0;
    const onlineTrace = selectCandidates(rows, { kind: 'online' });
    const nettedOnline = onlineTrace.candidates[0]?.row;

    return {
      configId: id,
      cabinCapacity: capacity,
      violations: checkInvariants(rows, capacity),
      rows: rows.map((r) => ({
        ...r,
        rawAvailable: rawAvailable(r),
        nettedAvailable:
          nettedOnline && r.id === nettedOnline.id ? rawAvailable(nettedOnline) : rawAvailable(r),
      })),
    };
  }

  /** Read-only waterfall preview: what would happen, without changing anything. */
  @Post(':id/waterfall')
  async waterfall(@Param('id', ParseIntPipe) id: number, @Body() body: IdentityDto) {
    const trace = await this.reservations.preview(id, toIdentity(body));
    return { ...trace, available: sumAvailable(trace) };
  }

  @Get(':id/ledger')
  ledgerFor(@Param('id', ParseIntPipe) id: number) {
    return this.ledger.forConfig(id);
  }

  @Post(':id/cutoff')
  async applyCutoff(@Param('id', ParseIntPipe) id: number) {
    await this.cutoff.apply(id, 'operator');
    return { ok: true };
  }
}
```

`apps/api/src/http/reservation.controller.ts`:

```typescript
import { Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ReservationService } from '../reservation/reservation.service.js';
import { ConfirmDto, ReserveDto } from './dto.js';
import { toIdentity } from './identity.js';

@Controller()
export class ReservationController {
  constructor(private readonly reservations: ReservationService) {}

  @Post('configs/:id/reservations')
  reserve(@Param('id', ParseIntPipe) id: number, @Body() body: ReserveDto) {
    return this.reservations.reserve({
      configId: id,
      identity: toIdentity(body),
      quantity: body.quantity,
      actor: 'api',
    });
  }

  @Post('reservations/:token/confirm')
  confirm(@Param('token') token: string, @Body() body: ConfirmDto) {
    return this.reservations.confirm(token, body.bookingRef, 'api');
  }

  @Post('reservations/:token/release')
  async release(@Param('token') token: string) {
    await this.reservations.release(token, 'api');
    return { ok: true };
  }
}
```

- [ ] **Step 5: Extract the shared row loader**

The `preview` method already loads rows; extract it so the controller can reuse it. In `apps/api/src/reservation/reservation.service.ts`, replace the body of `preview` with a call to a new public method:

```typescript
  /** Load a config's rows in engine shape, without locking. */
  async rowsFor(configId: number): Promise<AllocationRow[]> {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.channel, a.owner_id, a.allocation_type, a.funding_source,
              a.allocated_slots, a.sold_slots, a.held_slots, o.is_hidden AS owner_is_hidden
         FROM channel_allocations a
         LEFT JOIN owners o ON o.id = a.owner_id
        WHERE a.config_id = $1 ORDER BY a.id`,
      [configId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      channel: r.channel,
      ownerId: r.owner_id === null ? null : Number(r.owner_id),
      allocationType: r.allocation_type,
      fundingSource: r.funding_source,
      allocatedSlots: r.allocated_slots,
      soldSlots: r.sold_slots,
      heldSlots: r.held_slots,
      ownerIsHidden: r.owner_is_hidden ?? false,
    }));
  }

  async preview(configId: number, identity: RequesterIdentity): Promise<WaterfallTrace> {
    return selectCandidates(await this.rowsFor(configId), identity);
  }
```

Add `AllocationRow` to the `@slot/engine` type imports at the top of the file.

- [ ] **Step 6: Wire the application**

`apps/api/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Pool } from 'pg';
import { createPool } from './db/pool.js';
import { AllocationRepository } from './allocation/allocation.repository.js';
import { LedgerService } from './ledger/ledger.service.js';
import { ReservationService } from './reservation/reservation.service.js';
import { ExpiryService } from './reservation/expiry.service.js';
import { CutoffService } from './cutoff/cutoff.service.js';
import { AllocationController } from './http/allocation.controller.js';
import { ReservationController } from './http/reservation.controller.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AllocationController, ReservationController],
  providers: [
    { provide: Pool, useFactory: createPool },
    AllocationRepository,
    LedgerService,
    ReservationService,
    ExpiryService,
    CutoffService,
  ],
})
export class AppModule {}
```

`apps/api/src/main.ts`:

```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { InsufficientCapacityError } from './reservation/errors.js';
import { BadRequestException } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // A shortfall is a 409 with numbers, not a 500. The inspector renders these.
  app.useGlobalFilters({
    catch(error: unknown, host) {
      const res = host.switchToHttp().getResponse();
      if (error instanceof InsufficientCapacityError) {
        return res.status(409).json({
          error: 'insufficient_capacity',
          requested: error.requested,
          available: error.available,
          shortfall: error.shortfall,
        });
      }
      if (error instanceof BadRequestException) {
        return res.status(400).json(error.getResponse());
      }
      const name = error instanceof Error ? error.name : 'Error';
      const message = error instanceof Error ? error.message : 'unexpected error';
      const status = name === 'ReservationNotFoundError' ? 404 : name === 'ReservationNotOpenError' ? 409 : 500;
      return res.status(status).json({ error: name, message });
    },
  });

  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
```

- [ ] **Step 7: Run the tests and boot the API**

Run: `pnpm --filter @slot/api test`
Expected: PASS — all suites, including the 5 new identity tests.

Run: `pnpm --filter @slot/api dev` then in another shell `curl -s localhost:3001/configs/1 | head`
Expected: JSON, or a 500 naming a missing config if none is seeded yet. Stop the server afterwards.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): expose http surface with a hard-failing identity boundary"
```

---

### Task 12: Scenario seeds

**Files:**
- Create: `apps/api/src/seed/scenarios.ts`
- Create: `apps/api/src/seed/run.ts`
- Test: `apps/api/src/seed/scenarios.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/seed/scenarios.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { SCENARIOS, applyScenario } from './scenarios.js';
import { checkInvariants } from '@slot/engine';
import { ReservationService } from '../reservation/reservation.service.js';
import { AllocationRepository } from '../allocation/allocation.repository.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { testPool, resetDatabase } from '../db/test-helpers.js';

let pool: Pool;
let service: ReservationService;

beforeAll(() => {
  pool = testPool();
  service = new ReservationService(new AllocationRepository(pool), new LedgerService(pool), pool);
});
beforeEach(async () => {
  await resetDatabase(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('scenarios', () => {
  it('defines at least the documented set', () => {
    expect(SCENARIOS.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        'double-count-trap',
        'counter-siloed',
        'three-way-split',
        'managed-draws-pool',
        'hidden-owner-keeps-committed',
        'free-for-all',
      ]),
    );
  });

  it.each(SCENARIOS.map((s) => s.key))('seeds %s into a valid tree', async (key) => {
    const { configId, cabinCapacity } = await applyScenario(pool, key);
    const rows = await service.rowsFor(configId);
    expect(checkInvariants(rows, cabinCapacity)).toEqual([]);
  });

  it('makes the double-count trap visible', async () => {
    const { configId } = await applyScenario(pool, 'double-count-trap');
    const trace = await service.preview(configId, { kind: 'online' });
    const rows = await service.rowsFor(configId);
    const onlineRaw = rows.find((r) => r.channel === 'online')!;
    // Raw says 65 free; netting says 30. That gap is the bug this repo is about.
    expect(onlineRaw.allocatedSlots - onlineRaw.soldSlots - onlineRaw.heldSlots).toBe(65);
    expect(trace.candidates[0]!.row.allocatedSlots).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @slot/api test src/seed`
Expected: FAIL — cannot resolve `./scenarios.js`.

- [ ] **Step 3: Write the scenarios**

`apps/api/src/seed/scenarios.ts`:

```typescript
import type { Pool } from 'pg';

export interface ScenarioRow {
  channel: 'counter' | 'online' | 'marketplace' | 'partner_pool' | 'agency' | 'reseller';
  allocationType: 'direct' | 'flexible' | 'guaranteed';
  allocatedSlots: number;
  soldSlots?: number;
  heldSlots?: number;
  fundingSource?: 'online' | 'partner_pool';
  owner?: { name: string; hidden?: boolean };
}

export interface Scenario {
  key: string;
  title: string;
  /** The single rule this scenario is designed to demonstrate. */
  teaches: string;
  cabinCapacity: number;
  rows: ScenarioRow[];
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'double-count-trap',
    title: 'The double-count trap',
    teaches:
      'The online parent reads 65 free, but 35 is already carved out by its children. Only 30 is real.',
    cabinCapacity: 100,
    rows: [
      { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 },
      { channel: 'marketplace', allocationType: 'direct', allocatedSlots: 15 },
      { channel: 'online', allocationType: 'direct', allocatedSlots: 65 },
      {
        channel: 'agency',
        allocationType: 'guaranteed',
        allocatedSlots: 10,
        owner: { name: 'Northwind Travel' },
      },
      {
        channel: 'reseller',
        allocationType: 'flexible',
        allocatedSlots: 5,
        owner: { name: 'Seaway Resellers' },
      },
      { channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 },
    ],
  },
  {
    key: 'counter-siloed',
    title: 'Counter is siloed',
    teaches:
      'The counter never spills. A counter request for more than its own row fails even while online has seats.',
    cabinCapacity: 100,
    rows: [
      { channel: 'counter', allocationType: 'direct', allocatedSlots: 5 },
      { channel: 'online', allocationType: 'direct', allocatedSlots: 95 },
    ],
  },
  {
    key: 'three-way-split',
    title: 'One request, three rows',
    teaches:
      'A managed owner asking for 25 draws 8 from its own row, 12 from the netted pool, and 5 from online.',
    cabinCapacity: 100,
    rows: [
      { channel: 'online', allocationType: 'direct', allocatedSlots: 80 },
      { channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 },
      {
        channel: 'agency',
        allocationType: 'guaranteed',
        allocatedSlots: 8,
        fundingSource: 'partner_pool',
        owner: { name: 'Harbourline Managed' },
      },
      { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 },
    ],
  },
  {
    key: 'managed-draws-pool',
    title: 'Managed owners draw the pool, ordinary ones do not',
    teaches:
      'Two agencies with identical rows resolve to different candidate lists based solely on funding source.',
    cabinCapacity: 100,
    rows: [
      { channel: 'online', allocationType: 'direct', allocatedSlots: 80 },
      { channel: 'partner_pool', allocationType: 'flexible', allocatedSlots: 20 },
      {
        channel: 'agency',
        allocationType: 'guaranteed',
        allocatedSlots: 10,
        owner: { name: 'Ordinary Agency' },
      },
      {
        channel: 'agency',
        allocationType: 'guaranteed',
        allocatedSlots: 10,
        fundingSource: 'partner_pool',
        owner: { name: 'Managed Agency' },
      },
      { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 },
    ],
  },
  {
    key: 'hidden-owner-keeps-committed',
    title: 'A hidden owner keeps its committed seats',
    teaches:
      'The masked agency loses its 6 free seats to the parent but keeps the 4 it already sold, so those cannot be sold twice.',
    cabinCapacity: 100,
    rows: [
      { channel: 'online', allocationType: 'direct', allocatedSlots: 80 },
      {
        channel: 'agency',
        allocationType: 'flexible',
        allocatedSlots: 10,
        soldSlots: 4,
        owner: { name: 'Masked Agency', hidden: true },
      },
      { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 },
    ],
  },
  {
    key: 'free-for-all',
    title: 'Free-for-all',
    teaches:
      'With a single online direct row and no children, every channel draws from that one pool.',
    cabinCapacity: 100,
    rows: [{ channel: 'online', allocationType: 'direct', allocatedSlots: 100 }],
  },
];

export interface AppliedScenario {
  configId: number;
  cabinCapacity: number;
}

/** Create a fresh voyage, cabin, and config, then materialize the scenario's rows. */
export async function applyScenario(pool: Pool, key: string): Promise<AppliedScenario> {
  const scenario = SCENARIOS.find((s) => s.key === key);
  if (!scenario) throw new Error(`unknown scenario: ${key}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cfg } = await client.query<{ id: string }>(
      `WITH v AS (INSERT INTO vessels (name) VALUES ($2) RETURNING id),
            c AS (INSERT INTO cabins (vessel_id, name, capacity)
                  SELECT id, 'Economy', $1 FROM v RETURNING id, vessel_id),
            t AS (INSERT INTO voyages (vessel_id, departure_port, departs_at, booking_cutoff_at)
                  SELECT vessel_id, 'Port Aurora', now() + interval '2 days',
                         now() + interval '1 day' FROM c RETURNING id)
       INSERT INTO allocation_configs (voyage_id, cabin_id, cabin_capacity)
       SELECT t.id, c.id, $1 FROM t, c RETURNING id`,
      [scenario.cabinCapacity, `MV ${scenario.title}`],
    );
    const configId = Number(cfg[0]!.id);

    for (const row of scenario.rows) {
      let ownerId: number | null = null;
      if (row.owner) {
        const { rows: o } = await client.query<{ id: string }>(
          'INSERT INTO owners (name, is_hidden) VALUES ($1,$2) RETURNING id',
          [row.owner.name, row.owner.hidden ?? false],
        );
        ownerId = Number(o[0]!.id);
      }
      await client.query(
        `INSERT INTO channel_allocations
           (config_id, channel, owner_id, allocation_type, funding_source,
            allocated_slots, sold_slots, held_slots)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          configId,
          row.channel,
          ownerId,
          row.allocationType,
          row.fundingSource ?? 'online',
          row.allocatedSlots,
          row.soldSlots ?? 0,
          row.heldSlots ?? 0,
        ],
      );
    }

    await client.query(
      `INSERT INTO slot_movements (config_id, event_type, quantity, actor, reason)
       VALUES ($1,'config_init',0,'seed',$2)`,
      [configId, scenario.teaches],
    );
    await client.query('COMMIT');
    return { configId, cabinCapacity: scenario.cabinCapacity };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

`apps/api/src/seed/run.ts`:

```typescript
import { createPool } from '../db/pool.js';
import { SCENARIOS, applyScenario } from './scenarios.js';

async function main(): Promise<void> {
  const pool = createPool();
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
```

- [ ] **Step 4: Run the tests and the seed**

Run: `pnpm --filter @slot/api test src/seed`
Expected: PASS — 9 tests (2 named plus 6 parameterized plus 1).

Run: `pnpm --filter @slot/api db:seed`
Expected: six lines, one per scenario, each naming its config id.

- [ ] **Step 5: Add the root convenience scripts**

Add to the root `package.json` `scripts`:

```json
    "setup": "pnpm install && pnpm --filter @slot/api db:migrate && pnpm --filter @slot/api db:seed",
    "dev": "pnpm --parallel --filter @slot/api --filter @slot/web dev"
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/seed package.json
git commit -m "feat(api): seed named scenarios that each demonstrate one rule"
```

---

## Definition of done for Plan 02

- `docker compose up -d && pnpm setup` succeeds from a clean clone.
- `pnpm --filter @slot/api test` passes every suite, including the three concurrency tests.
- `pnpm --filter @slot/api typecheck` exits 0.
- The concurrency run output is captured in `docs/evidence/concurrency-run.txt`.
- No service file contains waterfall or netting logic; all of it comes from `@slot/engine`.
