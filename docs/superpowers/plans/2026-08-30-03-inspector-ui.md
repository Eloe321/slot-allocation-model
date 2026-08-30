# Slot Allocation (Plan 03: Inspector UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A scenario-driven inspector that makes the tree, the netting divergence, and the waterfall visible — live against the real API, so a reviewer poking at it exercises the actual engine.

**Architecture:** Next.js App Router talking to the NestJS API over HTTP. No mocked frontend state and no duplicated allocation logic: every number the UI shows comes from an endpoint, because a second implementation in the browser could drift from the engine and quietly tell a different story.

**Tech Stack:** Next.js 15, React 19, TypeScript. Visual layer settled through `impeccable craft` against running code — deliberately NOT pre-specified here.

**Prerequisites:** Plans 01 and 02 complete. `docker compose up -d && pnpm bootstrap`, API on :3001.

---

## Why the visual layer is not specified in this plan

Tasks 1–2 fix contracts and data flow, which are engineering decisions and are
specified exactly. Tasks 3–6 build interface, and their code is written through
the `impeccable craft` flow against a running dev server. Writing JSX here would
pre-empt that pass and produce code the design flow would discard. What IS
specified for those tasks is the *contract*: what each panel must show, and how
it is verified.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/http/scenario.controller.ts` | List scenarios; reset one |
| `apps/api/src/seed/scenarios.ts` | (modify) expose `resetScenario` |
| `apps/api/src/http/allocation.controller.ts` | (modify) include owner names |
| `apps/web/app/page.tsx` | Inspector shell, panel composition |
| `apps/web/lib/api.ts` | Typed client — the only place `fetch` appears |
| `apps/web/lib/types.ts` | Response types mirroring the API |
| `apps/web/components/tree-panel.tsx` | The allocation tree, raw vs netted |
| `apps/web/components/request-panel.tsx` | Identity + quantity, fires the API |
| `apps/web/components/waterfall-panel.tsx` | Ordered candidates, included/skipped |
| `apps/web/components/ledger-panel.tsx` | Append-only movement stream |
| `apps/web/app/globals.css` | Tokens (set by the design pass) |

---

### Task 1: API additions the UI needs

The UI needs three things the API does not yet expose: the scenario catalogue,
a way to reset one, and owner display names.

**Files:** Create `apps/api/src/http/scenario.controller.ts`; modify
`apps/api/src/seed/scenarios.ts`, `apps/api/src/http/allocation.controller.ts`,
`apps/api/src/app.module.ts`. Test: `apps/api/src/http/scenario.controller.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { listScenarios, resetScenario } from '../seed/scenarios.js';
import { testPool, resetDatabase } from '../db/test-helpers.js';

let pool: Pool;
beforeAll(() => { pool = testPool(); });
beforeEach(async () => { await resetDatabase(pool); });
afterAll(async () => { await pool.end(); });

describe('scenario catalogue', () => {
  it('lists every scenario with its key, title and teaching note', () => {
    const list = listScenarios();
    expect(list.length).toBeGreaterThanOrEqual(6);
    for (const s of list) {
      expect(s.key).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.teaches).toBeTruthy();
    }
  });

  it('reset returns a config id that is immediately readable', async () => {
    const { configId } = await resetScenario(pool, 'double-count-trap');
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM channel_allocations WHERE config_id = $1',
      [configId],
    );
    expect(rows[0].n).toBe(6);
  });

  it('reset is repeatable and leaves exactly one config for that scenario', async () => {
    const first = await resetScenario(pool, 'double-count-trap');
    const second = await resetScenario(pool, 'double-count-trap');
    expect(second.configId).not.toBe(first.configId);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM channel_allocations WHERE config_id = $1',
      [first.configId],
    );
    // The previous instance is gone, so a reviewer cannot accumulate stale trees.
    expect(rows[0].n).toBe(0);
  });

  it('rejects an unknown scenario key', async () => {
    await expect(resetScenario(pool, 'nope')).rejects.toThrow('unknown scenario');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @slot/api test src/http/scenario.controller.test.ts`
Expected: FAIL — `listScenarios` / `resetScenario` are not exported.

- [ ] **Step 3: Implement**

In `apps/api/src/seed/scenarios.ts` add:

```typescript
export interface ScenarioSummary {
  key: string;
  title: string;
  teaches: string;
  cabinCapacity: number;
}

/** The catalogue, without the row fixtures the UI does not need. */
export function listScenarios(): ScenarioSummary[] {
  return SCENARIOS.map(({ key, title, teaches, cabinCapacity }) => ({
    key,
    title,
    teaches,
    cabinCapacity,
  }));
}

/**
 * Rebuild one scenario from scratch.
 *
 * Deletes any existing configs for this scenario's vessel before re-applying, so
 * repeated resets cannot accumulate stale trees a reviewer might then compare
 * against by accident.
 */
export async function resetScenario(pool: Pool, key: string): Promise<AppliedScenario> {
  const scenario = SCENARIOS.find((s) => s.key === key);
  if (!scenario) throw new Error(`unknown scenario: ${key}`);
  await pool.query('DELETE FROM vessels WHERE name = $1', [`MV ${scenario.title}`]);
  return applyScenario(pool, key);
}
```

Create `apps/api/src/http/scenario.controller.ts`:

```typescript
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
```

In `allocation.controller.ts`, join owner names so the UI can label rows.
Change the `rowsFor` usage in the `tree` handler to additionally fetch names:

```typescript
    const owners = await this.pool.query<{ id: string; name: string; is_hidden: boolean }>(
      `SELECT DISTINCT o.id, o.name, o.is_hidden
         FROM owners o JOIN channel_allocations a ON a.owner_id = o.id
        WHERE a.config_id = $1`,
      [id],
    );
    const ownerName = (ownerId: number | null) =>
      ownerId === null ? null : (owners.rows.find((o) => Number(o.id) === ownerId)?.name ?? null);
```

and add `ownerName: ownerName(r.ownerId),` to each mapped row.

Register `ScenarioController` in `app.module.ts`'s `controllers` array.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @slot/api test` → all pass, +4.
Run: `pnpm --filter @slot/api typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): expose the scenario catalogue and owner display names"
```

---

### Task 2: Web scaffold and typed client

**Files:** `apps/web/package.json`, `tsconfig.json`, `next.config.ts`,
`app/layout.tsx`, `app/page.tsx`, `lib/types.ts`, `lib/api.ts`

- [ ] **Step 1: Scaffold**

`apps/web/package.json`:

```json
{
  "name": "@slot/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.1.6",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "@types/react": "^19.0.7",
    "@types/react-dom": "^19.0.3",
    "typescript": "^5.7.3"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "incremental": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next.config.ts`:

```typescript
import type { NextConfig } from 'next';

const config: NextConfig = {
  env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001' },
};

export default config;
```

Note: `apps/web/tsconfig.json` deliberately does NOT extend `tsconfig.base.json`.
The base sets `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, which
are right for the engine but fight React's prop types for no benefit here.

- [ ] **Step 2: Types and client**

`apps/web/lib/types.ts` — mirror the API exactly:

```typescript
export type Channel =
  | 'counter' | 'online' | 'marketplace' | 'partner_pool' | 'agency' | 'reseller';
export type AllocationType = 'direct' | 'flexible' | 'guaranteed';
export type FundingSource = 'online' | 'partner_pool';
export type WaterfallStep = 'primary' | 'partner_pool' | 'online_remainder';

export interface TreeRow {
  id: number;
  channel: Channel;
  ownerId: number | null;
  ownerName: string | null;
  allocationType: AllocationType;
  fundingSource: FundingSource;
  allocatedSlots: number;
  soldSlots: number;
  heldSlots: number;
  ownerIsHidden: boolean;
  rawAvailable: number;
  nettedAvailable: number;
}

export interface Violation { code: string; rowId: number | null; detail: string }

export interface Tree {
  configId: number;
  cabinCapacity: number;
  violations: Violation[];
  rows: TreeRow[];
}

export interface Candidate { row: TreeRow; step: WaterfallStep }
export interface Skipped { step: WaterfallStep; rowId: number | null; code: string; reason: string }

export interface Trace {
  candidates: Candidate[];
  skipped: Skipped[];
  freeForAll: boolean;
  available: number;
}

export interface Split { rowId: number; step: WaterfallStep; quantity: number }

export interface Reservation {
  token: string;
  expiresAt: string;
  splits: Split[];
  trace: Trace;
}

export interface Shortfall {
  error: 'insufficient_capacity';
  requested: number;
  available: number;
  shortfall: number;
}

export interface LedgerEntry {
  id: number;
  allocationId: number | null;
  eventType: string;
  quantity: number;
  actor: string;
  reason: string | null;
  token: string | null;
  createdAt: string;
}

export interface Scenario {
  key: string;
  title: string;
  teaches: string;
  cabinCapacity: number;
  configId: string | null;
}

export interface Identity {
  channel: Channel;
  ownerId?: number;
  managed?: boolean;
}
```

`apps/web/lib/api.ts` — the ONLY module that calls `fetch`:

```typescript
import type {
  Identity, LedgerEntry, Reservation, Scenario, Shortfall, Trace, Tree,
} from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw Object.assign(new Error(body.message ?? 'request failed'), { status: res.status, body });
  }
  return res.json() as Promise<T>;
}

export const api = {
  scenarios: () => json<Scenario[]>('/scenarios'),
  resetScenario: (key: string) =>
    json<{ configId: number }>(`/scenarios/${key}/reset`, { method: 'POST' }),
  tree: (configId: number) => json<Tree>(`/configs/${configId}`),
  waterfall: (configId: number, identity: Identity) =>
    json<Trace>(`/configs/${configId}/waterfall`, {
      method: 'POST',
      body: JSON.stringify(identity),
    }),
  reserve: (configId: number, identity: Identity, quantity: number) =>
    json<Reservation>(`/configs/${configId}/reservations`, {
      method: 'POST',
      body: JSON.stringify({ ...identity, quantity }),
    }),
  release: (token: string) =>
    json<{ ok: true }>(`/reservations/${token}/release`, { method: 'POST' }),
  cutoff: (configId: number) =>
    json<{ ok: true }>(`/configs/${configId}/cutoff`, { method: 'POST' }),
  ledger: (configId: number) => json<LedgerEntry[]>(`/configs/${configId}/ledger`),
};

export type { Shortfall };
```

- [ ] **Step 3: Verify the client reaches the API**

With the API running, `pnpm --filter @slot/web dev`, then confirm a page that
calls `api.scenarios()` renders six entries. Fix CORS if blocked — `main.ts`
already allows `http://localhost:3000`.

- [ ] **Step 4: Commit**

```bash
git add apps/web pnpm-lock.yaml package.json
git commit -m "feat(web): scaffold the inspector and its typed api client"
```

---

### Task 3: Design foundation (impeccable)

- [ ] **Step 1:** From `apps/web`, run
  `node <impeccable>/scripts/context.mjs`. It will report `NO_PRODUCT_MD`;
  follow `reference/init.md` to write `apps/web/PRODUCT.md`.
- [ ] **Step 2:** Read `reference/product.md` — this is app UI, where design
  SERVES the product, not brand-led marketing.
- [ ] **Step 3:** Run `scripts/palette.mjs` (new project, no committed brand
  colors) and compose tokens in OKLCH around the seed.
- [ ] **Step 4:** Write `apps/web/app/globals.css` with the token set.

**The one constraint fixed in advance:** colour is information-bearing only.
Capacity state — free, held, sold, netted-away — is the data. Decorative colour
competes with meaning and is out. Note also that the category reflex for a
developer tool is terminal-dark; that is a reason not to default to it. The
honest usage scene is a reviewer reading dense numeric content in a bright
browser tab among twenty others.

- [ ] **Step 5:** Commit `PRODUCT.md`, `DESIGN.md` and tokens.

---

### Task 4: Tree panel

**Contract — what it must show:**

- The allocation as an actual tree: `partner_pool` nested under `online`, and
  `partner_pool`-funded children nested under `partner_pool`. Nesting must
  follow `fundingSource`, not channel.
- Per row: `allocated`, `sold`, `held`, and **`rawAvailable` and
  `nettedAvailable` side by side**.
- Where the two diverge, that must be the most legible thing on the page. It is
  the repository's entire thesis.
- Cabin capacity, and any `violations` (empty in every shipped scenario).
- Hidden owners marked as such.

**Verification:** with `double-count-trap` selected, the `online` row shows
raw **65** and netted **30**; with `three-way-split`, `partner_pool` shows raw
**20** and netted **12**.

- [ ] Build it through `impeccable craft`, screenshot both scenarios, confirm the numbers.
- [ ] Commit: `feat(web): show the allocation tree with raw and netted availability`

---

### Task 5: Request panel and waterfall trace

**Contract:**

- Choose an identity: channel, plus owner and managed flag when the channel is
  `agency`/`reseller`. Owners come from the tree's rows, so only owners that
  exist on this config are offerable.
- Choose a quantity. Two actions: **preview** (calls `waterfall`, changes
  nothing) and **reserve** (calls `reservations`, actually holds seats).
- The trace renders the ordered candidate list: each entry's step, row, and free
  seats; then each skipped entry with its reason string.
- After a reserve, show the resulting splits — which rows gave how many — and a
  release control.
- A 409 shortfall renders as `requested / available / shortfall`, not as an error
  toast. A refusal is a legitimate outcome and the numbers are the interesting part.

**Verification:** as a managed owner on `three-way-split`, requesting 25 shows
three splits (8 / 12 / 5). As `counter` on `double-count-trap`, requesting 9999
shows available 20 with the "counter is siloed" skip reason.

- [ ] Build through `impeccable craft`.
- [ ] Commit: `feat(web): resolve an identity through the waterfall and show every step`

---

### Task 6: Ledger, cutoff, and the scenario picker

**Contract:**

- Scenario picker listing all six with their `teaches` line; selecting one calls
  `reset` and reloads the tree. This is what makes the inspector safe to poke at.
- Ledger panel: the movement stream, newest first, showing event type, quantity,
  row, actor, reason.
- A cutoff control, with the tree visibly changing afterwards.

**Verification:** run cutoff on a scenario with a flexible child and confirm the
tree still reports **zero violations** and that direct allocations still sum to
cabin capacity — cutoff preserves the partition, and the UI should make that
checkable.

- [ ] Build through `impeccable craft`.
- [ ] Commit: `feat(web): add the scenario picker, ledger stream and cutoff control`

---

### Task 7: Design and accessibility pass

- [ ] `impeccable critique` on the inspector; fix P0/P1 findings.
- [ ] `impeccable audit` for contrast, responsive behaviour, reduced motion.
- [ ] Verify: body text ≥ 4.5:1; the page does not scroll horizontally at 360px;
      the tree scrolls inside its own container rather than the body.
- [ ] Screenshot both key scenarios for the README.
- [ ] Commit: `style(web): polish the inspector for contrast and small screens`

---

## Definition of done

- `docker compose up -d && pnpm bootstrap && pnpm dev` gives a working inspector.
- `pnpm typecheck` clean across all three packages.
- The `double-count-trap` divergence (65 vs 30) is visible without interaction.
- Every number displayed comes from an API response; the browser contains no
  allocation arithmetic.
