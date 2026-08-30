# Implementation plans

Sequenced. Each plan produces working, testable software on its own.

| Plan | Covers | Status |
|---|---|---|
| [01 — Pure engine](2026-08-30-01-pure-engine.md) | Workspace, domain types, netting, waterfall, consumption planning, invariants, property tests | **Complete** — 54 tests, plus a post-review correctness pass (see below) |
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

## Plan 01 post-review correctness pass

A code review after Plan 01's tasks found three input classes where the engine
offered more seats than physically existed, all on trees its own
`checkInvariants` declared valid. All three were reproduced before being fixed:

| | tree (cabin capacity) | offered | physically free |
|---|---|---|---|
| C1 | hidden owner, 100-seat parent | 100 to *two* identities independently | 100 |
| C2 | parent sold 60/100, child allocated 50 | 50 | 40 |
| C3 | online-funded child with no online parent row | 80 | 60 |

**C1** was the structural one. `applyOwnerAvailability` exempted the requester's
own row from the hidden-owner collapse, so the netted tree differed per
requester: other channels saw the child collapsed and the parent hand its seats
back, while the masked owner still held them. Each view was self-consistent;
together they double-counted. The fix removed the exemption, which also made
`tree.ts` identity-free — netting no longer knows who is asking, so
cross-identity double-counting is impossible by construction rather than by test.

**C2 and C3 were spec defects**, not just code defects. The design spec's
invariants 3 and 4 compared children against the parent's allocation alone. Had
Plan 02 transcribed them literally into constraint triggers, both layers would
have encoded the same wrong rule and the defence-in-depth argument would have
been hollow. [The spec was corrected](../specs/2026-08-30-slot-allocation-remodel-design.md)
before any schema was written.

All three survived 1300 property runs because the property suite asserted a
*per-identity* bound where the spec's headline claim is *cross-identity*, over a
generator that never produced a hidden owner or a held seat. The replacement
drains every identity in turn and asserts total commitment never exceeds cabin
capacity; it was validated by temporarily reintroducing C1 and confirming it
failed, shrinking to 21 seats on a 20-seat cabin.
