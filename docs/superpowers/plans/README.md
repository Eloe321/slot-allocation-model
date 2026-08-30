# Implementation plans

Sequenced. Each plan produces working, testable software on its own.

| Plan | Covers | Status |
|---|---|---|
| [01 — Pure engine](2026-08-30-01-pure-engine.md) | Workspace, domain types, netting, waterfall, consumption planning, invariants, property tests | Written |
| [02 — Persistence and API](2026-08-30-02-persistence-and-api.md) | Postgres schema, deferred constraint triggers, locking repository, holds, cutoff, ledger, concurrency proof, HTTP surface, scenario seeds | Written |
| 03 — Inspector UI | Next.js tree, request panel, waterfall trace, ledger stream | Written at its phase boundary |
| 04 — README and ADRs | The source-of-truth README, ten decision records | Written at its phase boundary |

## Why 03 and 04 are written later

Not an omission. Both depend on artifacts that do not exist yet:

- **03** must be driven through `impeccable craft` against real components and a
  running dev server. Hand-writing JSX now would pre-empt that flow and produce
  code the design pass would immediately discard.
- **04** quotes the concurrency test's *actual* output (`docs/evidence/concurrency-run.txt`,
  produced by Plan 02 Task 10) and the engine's final API surface. Drafting that
  prose against predicted output would risk publishing numbers that never ran.

Write each one when its prerequisite plan is green.

## Spec coverage

Every section of
[the design spec](../specs/2026-08-30-slot-allocation-remodel-design.md)
maps to a task:

| Spec section | Where |
|---|---|
| §3 Domain model, managed vs. hidden | 01 Task 2; 01 Task 5; 02 Task 11 |
| §4 Governing idea (partition, not list) | 01 Task 3 |
| §5 Capacity mathematics | 01 Tasks 3-4 |
| §5 Invariants | 01 Task 9; 02 Tasks 2-3 |
| §6 Waterfall order, free-for-all | 01 Tasks 6-7 |
| §6 Identity hard-fail | 02 Task 11 |
| §6 Unavailable-owner collapse | 01 Task 5 |
| §7 Holds, links, release | 02 Tasks 6-7 |
| §7 TTL expiry | 02 Task 8 |
| §7 Cutoff | 02 Task 9 |
| §7 Ledger | 02 Task 5 |
| §8 Pure engine, locking shell | 01 (all); 02 Task 4 |
| §9 Three correctness layers | 01 Task 9; 02 Task 4; 02 Tasks 2-3 |
| §10 Testing incl. concurrency proof | 01 Task 10; 02 Task 10 |
| §11 Inspector UI | Plan 03 |
| §12-13 README and ADRs | Plan 04 |
| §14 Reproducibility | 02 Tasks 1, 12 |
| §15 Hygiene | Commit messages throughout |
