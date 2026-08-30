# ADR-0011 — Netting must not depend on who is asking

## Context

A child row whose owner has been deleted or masked loses its entitlement, but
its already-sold seats must stay carved out of the parent — otherwise seats that
are sold get sold again.

The original implementation collapsed such rows for every requester *except the
masked owner itself*, on the reasoning that an owner should still see its own
allocation. This project reproduced that behaviour faithfully.

## The problem

It oversells. Cabin capacity 100:

```
online   direct      allocated 100
agency#7 guaranteed  allocated  30   ownerIsHidden: true, funded from online
```

| requester | offered |
|---|---|
| `online` | **100** — the child is collapsed, so nothing nets out of the parent |
| hidden `agency#7` | **100** — its own row is exempt (30), plus the parent netted to 70 |

Both views are internally consistent. Applied in sequence they hold **130 seats
on a 100-seat cabin**, and `checkInvariants` reports the resulting state as
valid — because no single row is overcommitted.

The root cause is structural rather than arithmetic: `applyOwnerAvailability`
took the requester as a parameter, so **the netted tree differed per requester**.
Other channels saw the child collapsed and the parent hand its seats back, while
the owner simultaneously still held them.

## Decision

Remove the exemption. `applyOwnerAvailability(rows)` takes no identity, and a
masked owner's row is collapsed for everyone including itself.

## Consequences

- One tree, one answer, for every requester. Cross-identity double-counting
  becomes impossible **by construction** rather than by test.
- `tree.ts` no longer imports `RequesterIdentity` at all. That the netting module
  cannot even name the requester is the property worth having.
- A masked owner keeps its sold and held seats and loses only its free
  entitlement, which is what "the owner is gone" should mean.
- **What the exemption was better at:** letting a Hayahai-managed agency in the
  original system still draw its own allocation. In that system managed agencies
  are served through a separate pool, so the exemption may be compensated
  elsewhere; here it is simply wrong.

## How it was found

Not by the test suite. It survived 1,300+ property runs because the property
asserted a **per-identity** bound — `sumAvailable(trace) <= capacity − sold` —
which is trivially satisfiable and structurally incapable of detecting
divergence *between* identities. The generator also never produced a hidden
owner.

The replacement drains every identity in turn and asserts that total commitment
across all rows never exceeds cabin capacity. It was validated by temporarily
reintroducing this bug and confirming it failed, shrinking to a minimal
counterexample of 21 seats on a 20-seat cabin. A property that has never been
seen to fail has not been shown to test anything.
