# ADR-0001 — Keep the allocation logic in a dependency-free package

## Context

The interesting part of this system is roughly 575 lines: netting, waterfall
resolution, consumption planning, invariants. The uninteresting part — locking,
SQL, HTTP, scheduling — is much larger. Where the interesting part lives
determines how it can be tested and whether it can be read.

## Options

**A. Inside the NestJS services.** Conventional. One less package, no indirection.
**B. A pure package with zero I/O**, consumed by a thin transactional shell.
**C. Database functions.** Logic next to the data, one round trip.

## Decision

**B.** `packages/engine` imports nothing but its own modules. It takes plain
objects and returns plain objects.

## Consequences

- The algorithm is unit-testable with no database and no mocks, which is what
  makes property-based testing practical: 1,300+ generated trees per run.
- The whole decision surface can be quoted in a README. That is the difference
  between a reader understanding the system and taking it on trust.
- Netting is a pure function of the rows, so it cannot accidentally depend on
  request state. This became load-bearing — see [ADR-0011](0011-identity-free-netting.md).
- **What A would have been better at:** fewer moving parts, and no risk of the
  shell and the engine disagreeing about types. **What C would have been better
  at:** atomicity for free, and no chance of a second consumer bypassing the
  rules. C was rejected because PL/pgSQL is untestable at the granularity this
  logic needs, and because the argument this repository makes has to be
  *readable*.
