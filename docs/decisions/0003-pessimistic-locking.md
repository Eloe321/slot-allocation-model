# ADR-0003 — Pessimistic row locks in a deterministic order

## Context

Concurrent reservations against the same trip must not oversell. Under
contention, the last ten seats will be requested by fifty people at once.

## Options

**A. `SELECT … FOR UPDATE`** on the config, then its rows ordered by id.
**B. Optimistic concurrency** — a version column, compare-and-swap, retry.
**C. Postgres advisory locks** keyed on config id.
**D. `SERIALIZABLE` isolation** and retry on serialization failure.

## Decision

**A.** Lock the config row first, which serializes writers on one config. Then
lock the allocation rows `ORDER BY id`, giving every transaction the same
acquisition order.

## Consequences

- Deterministic ordering is what removes deadlock. Two requests touching
  overlapping rows in different orders will deadlock; ordering by id means they
  cannot.
- Contention is naturally scoped: one trip's cabin. Different sailings do not
  block each other.
- The lock is `FOR UPDATE OF a` rather than bare `FOR UPDATE`, because the
  query joins `owners` and would otherwise lock owner rows too — blocking
  unrelated configs that happen to share an agency.
- **What B would have been better at:** throughput under low contention, and no
  held locks across the transaction. It was rejected because the retry storm
  under *high* contention is exactly the scenario that matters here, and because
  a request splitting across three rows needs all three consistent at once.
  **What D would have been better at:** correctness with no explicit lock
  management at all — but it converts contention into serialization failures the
  caller must retry, which pushes the hard part into every consumer.

Verified: fifty concurrent requests for ten seats grant exactly ten. See
[`docs/evidence/concurrency-run.txt`](../evidence/concurrency-run.txt).
