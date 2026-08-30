# ADR-0004 — Let one request draw from several rows

## Context

An agency asking for 25 seats may have 8 on its own row, with the rest available
from pools it is entitled to. Either the request is satisfied from one row or it
spans several.

## Options

**A. All-or-nothing** — one row must satisfy the whole request.
**B. Split across candidates** in waterfall order, taking what each can give.

## Decision

**B.** `planConsumption` walks the ordered candidates and emits one split per
row it draws from.

## Consequences

- No stranded capacity. Under A, an agency with 8 free seats asking for 10 is
  refused while 8 seats sit unsold — and refused *while the operator's pool has
  room*, which is not a defensible answer to a customer.
- Each split becomes its own hold row, booking link and ledger entry. This is
  not bookkeeping ceremony: it is what allows a later release to return seats to
  the exact rows they came from. See [ADR-0005](0005-durable-links.md).
- **What A would have been better at:** simplicity. One row, one hold, one
  link, and release is trivial. The cost — refusing bookings while seats exist —
  is not worth that simplicity for an inventory system.
