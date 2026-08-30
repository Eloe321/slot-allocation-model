# Slot Allocation Remodel — Design

**Date:** 2026-08-30
**Status:** Approved, ready for planning

## 1. Purpose

Rebuild the slot-allocation feature — originally built inside a proprietary
multi-tenant ferry booking platform — as a self-contained, public, runnable
repository that demonstrates the design reasoning behind it.

The audience is a technical reviewer: a hiring engineer or a prospective
freelance client, giving the repo somewhere between ninety seconds and an hour.
The artifact is therefore judged on whether the reasoning is legible, not on
feature parity with the original.

Two consequences follow, and they govern every decision below:

- **The README is the source of truth.** A reader must be able to understand
  the model, the mathematics, the algorithm, and the trade-offs without opening
  a source file.
- **Scope is chosen for explanatory value.** The original is roughly 20k lines
  excluding tests. Anything that is CRUD, duplication, or infrastructure
  specific to the original deployment is cut, and the cut is stated and
  defended rather than silently made.

### Non-goals

- Feature parity with the original implementation.
- Production multi-tenancy, authentication, or payment integration.
- Reuse of the original client's naming, branding, or domain vocabulary.

## 2. Scope

### In scope

Tree capacity model · parent netting · waterfall resolution with splitting ·
TTL holds · durable booking-to-row links · cutoff release · append-only
movement ledger · concurrency safety with a test that proves it · a
scenario-driven inspector UI · README and ADRs.

### Out of scope, with reasons (each becomes an ADR)

| Cut | Reason |
|---|---|
| Cargo / lane-meter track | The passenger path with `numeric(10,3)` instead of `int`. Pure duplication; adds volume, not insight. |
| Shipper channel | Exists to own cargo capacity. Follows the cargo track out. |
| Templates, versions, snapshots | Mostly CRUD and version pinning. Configs are seeded directly instead. |
| Multi-tenant proxying, identity federation | Deployment topology of the original system, not part of the allocation problem. |

## 3. Domain model

Anonymized. No client or brand names appear anywhere in the repository.

A **voyage** is a dated sailing of a **vessel** from a port. Each
voyage x **cabin** pair has exactly one *allocation config*: the tree of
capacity buckets that bookings consume.

### Channels

| Channel | Role | Owner dimension |
|---|---|---|
| `counter` | Walk-up inventory. Direct, and deliberately siloed. | none |
| `online` | Direct online sales, and the parent pool that agency/reseller children are carved from. | none |
| `marketplace` | Explicit direct marketplace partition. | none |
| `partner_pool` | Shared pool that managed (identity-masked) owners draw from. Itself a child of `online`. | none |
| `agency` | Dedicated child allocation. | `owner_id` |
| `reseller` | Dedicated child allocation. | `owner_id` |

`agency` and `reseller` behave identically in the waterfall and are
nevertheless kept distinct: collapsing them would erase the composite
`(channel, owner_id)` primary matching that the identity-safety rules exist to
demonstrate.

### Row attributes

- `allocation_type` — `direct` (top-level physical partition) | `flexible`
  (child, reclaimable at cutoff) | `guaranteed` (child, protected at cutoff).
- `funding_source` — `online` | `partner_pool`. Identifies **which parent this
  child was carved out of**. This single field is what makes the tree a tree.
- `allocated_slots`, `sold_slots`, `held_slots` — integers.
- `owner_id` — nullable; meaningful only for `agency` and `reseller`.
- `owner_is_hidden` — enrichment flag; see the unavailable-owner rule.

### Two orthogonal identity concepts

These are distinct and must not be conflated in implementation:

- **Managed** is a property of the *requester*. A managed identity is one whose
  dedicated capacity is funded from `partner_pool` rather than from `online`.
  It decides two things: which row matches as the requester's primary
  (`funding_source = 'partner_pool'` rather than `<> 'partner_pool'`), and
  whether `partner_pool` appears in the candidate list at all.
- **`owner_is_hidden`** is a property of a *row*. It marks a child row whose
  owner is deleted or masked, and drives only the unavailable-owner collapse
  described in section 6. It grants no pool access.

A managed requester need not have a hidden row, and a hidden row need not
belong to a managed requester.

## 4. The governing idea

> The allocation tree is a **capacity partition, not a list of independent
> capacities.** A child row is not additional seats. It is a claim staked
> inside its parent.

If this is not enforced, the parent continues to advertise capacity that a
child already holds, and the same physical seat is sold twice. Every invariant,
test, and README section is downstream of this sentence.

Worked example, cabin capacity 100:

```
cabin capacity: 100
+- counter        direct       20
+- marketplace    direct       15
+- online         direct       65   <- parent
   +- agency#7    guaranteed   10   funding: online
   +- reseller#3  flexible      5   funding: online
   +- partner_pool flexible    20   funding: online   <- itself a parent
      +- agency#9 guaranteed    8   funding: partner_pool
```

`online.allocated` reads 65. Only **30** is genuinely free; 35 is spoken for.

## 5. Capacity mathematics

### Row level

```
raw_available(r) = max(0, allocated_slots - sold_slots - held_slots)
```

Enforced at the database level by `CHECK (sold_slots + held_slots <= allocated_slots)`.

### Online parent netting

```
online_children  = SUM(allocated_slots)
                   WHERE allocation_type IN ('flexible','guaranteed')
                     AND funding_source <> 'partner_pool'

online_committed = online.sold_slots + online.held_slots

online_effective = max(online_committed,
                       online.allocated_slots - online_children)

online_available = max(0, online_effective - online_committed)
```

The `max(online_committed, ...)` clamp is load-bearing. Without it, an
administrator enlarging a child beyond what the parent has already committed
drives effective allocation negative, and the row reports nonsense rather than
zero.

### Partner pool netting

```
pool_available = max(0, partner_pool.allocated_slots
                        - SUM(children WHERE funding_source = 'partner_pool')
                        - partner_pool.sold_slots
                        - partner_pool.held_slots)
```

### Invariants

1. Per row: `sold + held <= allocated`.
2. `SUM(direct allocations) <= cabin capacity`.
3. `SUM(online-funded children) + online.sold + online.held <= online.allocated`.
4. `SUM(partner-funded children) + pool.sold + pool.held <= pool.allocated`.
5. Every online-funded child requires an unowned `online` direct row to exist;
   every partner-funded child requires a `partner_pool` row to exist.
6. At most one unowned `online` direct row, and at most one `partner_pool` row,
   per config.
7. At most one row per `(channel, owner_id)`.
8. Golden: `physical sold + open holds <= physical capacity` at all times.

Invariants 3 and 4 must include the parent's own committed seats. The weaker
form — comparing children against the parent's *allocation* alone — admits a
parent that has sold 60 of 100 while a child holds 50: the child's seats are
free by its own row, the parent's are committed, and together they exceed the
partition. The parent's commitments and its children's carve-outs draw on the
same physical seats, so both belong on the same side of the inequality.

Invariant 5 exists because a child whose parent row is absent belongs to no
physical partition at all, and is therefore capacity conjured from nothing.

Invariants 6 and 7 make row identity unambiguous. Without 6, "the online row"
is whichever the query returns first, and netting may be applied to one row
while a second is offered un-netted.

Invariant 7 keys on `(channel, owner_id)` and deliberately NOT on funding
source. An owner is either managed or it is not — that is a property of the
owner, not of a row — and the primary matcher filters on funding source
accordingly. An owner holding both an online-funded and a partner-funded row
therefore has exactly one of them matchable by any identity, while both are
netted out of their parents: the unmatched row's seats are carved away and
reachable by nobody.

Invariant 8 must never be checked by summing every row blindly, because
parents and children overlap by design. It is verified through the netted
model and the reconciliation queries.

## 6. Waterfall

An identity resolves to an **ordered candidate list**. A single request may
split across several candidates. Each split becomes its own hold row, booking
link, and ledger entry, so that a later release returns seats to the exact
rows they were taken from — not to whatever channel the booking nominally
belongs to.

| Requester | Candidate order |
|---|---|
| `counter` | own row only; never falls back |
| `agency` / `reseller`, ordinary | own row, then netted `online` remainder |
| `agency` / `reseller`, managed | own row if present, then `partner_pool`, then netted `online` remainder |
| `marketplace` | own row, then netted `online` remainder; never the pool |
| `online` direct | the netted `online` row only |
| free-for-all | config is a single `online` direct row; that row serves every channel |

### Identity safety

- **Unresolved owner hard-fails.** An `agency` or `reseller` request whose
  `owner_id` is null must throw. A null owner matches the *unowned* online row,
  so a silent fallthrough would drain the operator's pool under an agency's
  name — a data-integrity bug indistinguishable from normal traffic in logs.
- **Unavailable-owner collapse.** When a child's owner is deleted or masked,
  the row loses its free entitlement but retains `sold + held` as an effective
  carve-out. Returning committed seats to the parent would allow already-sold
  seats to be sold a second time.

  The collapse applies to **every** requester, including the masked owner
  itself. Exempting the owner's own row makes the netted tree differ by
  requester: other channels see the child collapsed and the parent hands its
  seats back, while the owner simultaneously still holds them. Each view is
  internally consistent; together they double-count. Netting must therefore not
  depend on who is asking — one tree, one answer, for everyone.

## 7. Lifecycle

### Holds

```
POST /reservations              -> token (uuid), TTL 600s, held += qty across splits
POST /reservations/:token/confirm -> held -= , sold += , links inserted
POST /reservations/:token/release -> held -= , seats returned to source rows
sweeper (interval)              -> expires stale tokens, returns seats
```

Token states: `open` | `confirmed` | `released` | `expired`. Confirmation is
idempotent only when every row under the token is already confirmed. A
released or expired token must never increase sales. An unknown token is a
404.

### Booking links

Confirmation writes a durable `booking_slot_links` row per split. The link,
not the booking's declared source channel, determines where capacity returns
on cancellation. This is essential precisely because the waterfall may have
drawn from two or three different rows.

### Cutoff

At the voyage booking cutoff, unsold capacity that channels no longer need is
consolidated onto `counter`. `flexible` children and direct `online` /
`marketplace` rows give up their free portion; `guaranteed` children keep
theirs. Sold and held seats never move.

**Cutoff must preserve the partition.** Two rules make it do so:

```
movable(r) = allocated - own_children - sold - held     (netted, not raw)

when a child releases X:  child.allocated          -= X
                          funding_parent.allocated -= X
                          counter.allocated        += X
```

The netting matters because a parent's raw free portion includes seats its
children already hold; releasing that to `counter` hands the same seat to two
places. The parent decrement matters because a child giving up capacity already
returns that headroom to its parent - crediting `counter` as well counts it
twice. Together these errors are large: on a 100-seat cabin with a 90-seat
online parent (5 sold), a 20-seat flexible child (3 sold) and a 15-seat
guaranteed child (2 sold), the naive `allocated - sold - held` form yields 135
reachable seats.

A useful consequence: because every release decrements a parent by exactly what
it credits to `counter`, the sum of direct allocations stays equal to cabin
capacity, and each parent lands exactly on its ceiling
(`allocated = children + sold + held`). Post-cutoff state therefore satisfies
every invariant in section 5 unchanged, and the database constraints need **no
cutoff exemption** - layer three stays armed at all times, including during the
one operation that rewrites the most rows.

A `cutoff_applied_at` timestamp makes the sweep idempotent, and every movement
is recorded in the ledger.

### Ledger

`slot_movements` is append-only: config and row context, source and
destination row ids, quantity, event type, actor, reason, reservation token
where relevant, timestamp. The ledger explains **why** capacity changed;
reconciliation queries verify **that** counters agree with links and open
holds.

## 8. Architecture

### Pure engine

```
packages/engine/         zero I/O: no Nest, no Drizzle, no Postgres
  tree.ts                netting -> effective availability per row
  waterfall.ts           identity -> ordered candidate list
  plan.ts                (candidates, qty) -> splits, or a typed shortfall
  invariants.ts          assertions shared by the tests and the schema
```

All algorithmically significant logic lives in roughly 300 lines of pure
functions over plain objects. This is the central structural decision
(ADR-0001). It yields three properties the rest of the design depends on:

1. The algorithm is unit-testable with no database and no mocks.
2. Property-based tests can generate thousands of trees and assert invariants.
3. The README can quote the complete decision logic inline, which is what
   makes the repository readable without opening it.

### Service shell

```
BEGIN
  SELECT ... FROM allocation_configs WHERE id = $1 FOR UPDATE
  SELECT ... FROM channel_allocations WHERE config_id = $1 FOR UPDATE ORDER BY id
  -> hand plain rows to the pure engine
  <- receive splits
  apply deltas; insert holds / links; append ledger rows
COMMIT
```

Locking the config row first serializes concurrent edits to one config.
Ordering the row locks by `id` gives deterministic acquisition order and
removes deadlock between concurrent requests touching overlapping rows.

### Repository layout

```
README.md
docs/decisions/           ADR-0001..0010, linked inline from the README
docker-compose.yml        postgres:16, healthcheck, named volume
packages/engine/          pure core, vitest, fast-check
apps/api/                 NestJS: reservations, cutoff, ledger, reads
  drizzle/                schema.ts plus hand-written .sql migrations
apps/web/                 Next.js inspector
```

Stack: pnpm workspaces, TypeScript, NestJS, Next.js, PostgreSQL 16, Drizzle
for schema and typed reads, raw SQL for the locking walk and the constraint
triggers.

## 9. Correctness in three layers

Defence in depth. Each layer catches what the layer above cannot.

1. **Engine invariants** — pure assertions, exhaustively property-tested.
2. **Service and transaction** — locks and validation, whose purpose is
   correct concurrent behaviour and good error messages.
3. **Database** — per-row `CHECK` constraints, plus **deferred** constraint
   triggers for the two pool ceilings. Deferred because a legitimate multi-row
   edit is transiently invalid mid-transaction and need only balance at
   `COMMIT`.

If the service layer were the sole guard, any future code path that omitted
the check could oversell. The database cannot be bypassed.

## 10. Testing

- **Unit** — pure engine, vitest.
- **Property-based** — fast-check over generated trees. Headline property: the
  sum of waterfall availability across every identity never exceeds physical
  free capacity.
- **Integration** — against real Postgres, not a mock.
- **The concurrency proof** — `N` concurrent requests for the last `M` seats.
  Exactly `M` succeed; every loser receives a typed shortfall rather than a
  crash; the ledger sums to the seats actually moved; no row violates its
  invariant. Its real output is pasted into the README.

## 11. Inspector UI

Four panels, one responsibility each. The scenario picker resets the database
to a known state; every other panel is live against the real API, so a
reviewer poking at the UI is exercising the actual engine rather than mocked
frontend state.

- **Tree** — the allocation rendered as a tree. Each node shows
  `allocated / sold / held` and, side by side, **raw available versus netted
  available**. Making the divergence visible is the argument.
- **Request** — choose an identity (channel, owner, managed flag) and a
  quantity; fires the real endpoint.
- **Waterfall trace** — the ordered candidate list, each entry annotated
  *included and why* or *skipped and why*, with the seats drawn from each.
- **Ledger** — the append-only movement stream.

### Scenarios

Each lands on exactly one rule: the double-count trap · counter is siloed · a
request splitting across three rows · unresolved owner hard-fails · managed
owner draws the pool · unavailable owner keeps its committed seats · hold
expiry returns seats · cutoff sweeps flexible but spares guaranteed · fifty
concurrent requests for ten seats.

### Visual direction

Settled against real code via `impeccable craft` during implementation. One
constraint is fixed now: **colour is information-bearing only.** Capacity
state (free / held / sold / netted-away) is the data, so decorative colour
competes with meaning and is excluded. The category reflex for a developer
tool is terminal-dark, which is reason enough not to default to it; the honest
usage scene is a reviewer reading dense numeric content in a bright browser
tab among many others, which argues for high-contrast light with a single
committed accent.

## 12. README structure

Linear, with worked numbers throughout:

1. What this is, with a screenshot
2. Why partitioned capacity is hard
3. Quickstart
4. The model
5. The capacity mathematics
6. The waterfall
7. Lifecycle: holds, links, cutoff
8. Concurrency, with the race test's real output
9. The ledger
10. Testing strategy
11. Decisions index
12. What was deliberately left out, and why
13. Scenario catalogue

Section 12 carries disproportionate weight: scope cuts stated confidently read
as judgment, whereas unexplained absences read as gaps.

## 13. Decision records

| ADR | Decision |
|---|---|
| 0001 | Pure engine versus logic embedded in the service |
| 0002 | Netting at read time versus materialized effective columns |
| 0003 | Pessimistic row locks versus optimistic versioning, advisory locks, or `SERIALIZABLE` |
| 0004 | Splitting a request across rows versus all-or-nothing |
| 0005 | Durable booking-to-row links versus re-deriving from booking source |
| 0006 | Deferred constraint triggers versus service-only validation |
| 0007 | Dropping the cargo / lane-meter track |
| 0008 | Dropping templates and snapshots |
| 0009 | Drizzle plus raw SQL versus Prisma |
| 0010 | TTL sweeper versus lazy expiry on read |

Each ADR states the context, the options considered, the decision, and the
consequences — including what the rejected option would have been better at.

## 14. Reproducibility

```
docker compose up -d
pnpm setup     # install, migrate, seed
pnpm dev       # api + web
```

Postgres 16 in a container; migrations applied; a deterministic seed script
builds the named scenarios. A `pg_dump` would also reproduce state, but a
versioned seed script is readable, diffable, and cannot drift from the schema.

## 15. Repository hygiene

No AI attribution anywhere in the repository: no `Co-Authored-By` trailers, no
"Generated with" lines, no assistant references in commit messages, code
comments, or documentation. Commits are authored as the repository owner and
sequenced as genuine incremental development — schema, engine, service,
concurrency proof, UI, documentation — because a reviewer will read the
history.
