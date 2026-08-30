# ADR-0006 — Enforce the invariants in the database too, with deferred triggers

## Context

The engine checks the structural rules and the service validates before writing.
A third layer is redundant by construction — that is the point of it.

## Options

**A. Service-layer validation only.**
**B. Immediate `CHECK` constraints** for everything expressible that way.
**C. Deferred constraint triggers** for the multi-row rules, immediate `CHECK`
for the single-row ones.

## Decision

**C.** Per-row rules (`sold + held <= allocated`, owner/channel agreement) are
immediate `CHECK`s. The multi-row ceilings — parent capacity, orphaned children,
cabin capacity — are a `DEFERRABLE INITIALLY DEFERRED` constraint trigger. Row
identity is enforced by partial unique indexes.

## Consequences

- Deferred because a legitimate multi-row edit is transiently invalid. Enlarging
  a child then its parent is valid at `COMMIT` but invalid between the two
  statements; an immediate constraint would reject it depending on statement
  order.
- The database cannot be bypassed. Any future code path that forgets a check —
  a migration script, a manual fix, a second service — still cannot oversell.
- All nine engine violation codes have a SQL counterpart. That correspondence is
  the whole claim; a "defence in depth" where one layer is a subset of the other
  is one layer wearing a hat.
- **What A would have been better at:** better error messages, and no rules
  expressed in two languages that must be kept in step. The second cost is real
  and is paid deliberately — see [ADR-0012](0012-armed-through-cutoff.md) for
  what happened when the two nearly diverged.
