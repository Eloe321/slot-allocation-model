# ADR-0009 — Drizzle for schema, hand-written SQL for the parts that matter

## Context

The claim is that the database independently enforces the invariants. A reader
has to be able to check that claim by reading the migration.

## Options

**A. Prisma**, with `$queryRaw` escape hatches for locking.
**B. Drizzle** plus hand-written `.sql` migrations.
**C. `node-postgres` and Kysely** — no ORM at all.

## Decision

**B.** Migrations are plain `.sql` files. The locking walk is hand-written SQL.

## Consequences

- The constraint triggers and partial unique indexes are readable as SQL, which
  is exactly what the defence-in-depth argument rests on. Generated migration
  noise would obscure the one thing worth reading.
- `SELECT … FOR UPDATE OF a ORDER BY a.id` is written out, not hidden behind an
  escape hatch — appropriate, since the lock ordering *is* the concurrency
  design.
- **What A would have been better at:** familiarity, and a generated client that
  most reviewers can read at a glance. It was rejected because it makes the
  interesting SQL the exception rather than the norm. **What C would have been
  better at:** nothing hidden at all — rejected only as more boilerplate than
  the project needs.
