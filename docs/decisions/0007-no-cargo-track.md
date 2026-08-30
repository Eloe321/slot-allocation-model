# ADR-0007 — Leave out the cargo / lane-metre track

## Context

The original system allocates vehicle deck space as well as passenger seats.
Cargo uses `numeric(10,3)` lane metres instead of integer seats, with its own
tables, services and controllers.

## Decision

Passengers only.

## Consequences

- Cargo is the passenger path with a different numeric type. It duplicates the
  waterfall, the netting, the holds and the ledger, and demonstrates nothing the
  passenger path does not.
- Roughly doubles the code for no additional idea. A reader who understands the
  seat model understands the metre model.
- **What including it would have shown:** that the engine generalizes over the
  quantity type — genuinely interesting, and the honest way to demonstrate it
  would be to make the engine generic over the unit rather than to copy it. That
  is a better project than a bigger one.
