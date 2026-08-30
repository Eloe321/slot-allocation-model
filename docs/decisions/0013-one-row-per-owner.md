# ADR-0013 — One row per owner per channel, regardless of funding source

## Context

Row identity must be unambiguous, so the schema carries a partial unique index
over owned rows. The question is what the key is.

The first version keyed on `(config_id, channel, owner_id, funding_source)`,
reasoning that the funding source distinguishes a managed entitlement from an
ordinary one and both might legitimately exist.

## The problem

It strands capacity. Cabin capacity 100:

```
online       direct        80
counter      direct        20
partner_pool flexible      20   funded from online
agency#7     guaranteed    10   funded from online
agency#7     guaranteed    10   funded from partner_pool
```

`checkInvariants` reported this valid. Draining every identity reaches **90 of
the 100 allocated seats**. Ten are gone.

The mechanism is in the primary matcher. `selectPrimary` filters on
`funding === 'partner_pool'` for a managed requester and `!==` for an ordinary
one:

```
owner 7, managed=false   primary=row4   candidates=[row4, row1]
owner 7, managed=true    primary=row5   candidates=[row5, row3, row1]
```

An owner is either managed or it is not — that is a property of the owner, not
of a row. So exactly one of those two rows is matchable by the real owner, and
no other identity matches an owned row at all. Meanwhile **both** are counted by
`sumOnlineFundedChildren` / `sumPartnerFundedChildren` and netted out of their
parents. The unmatched row's ten seats are carved out of the partition and
reachable by nobody.

Stranding is a quieter failure than overselling — nobody is turned away at the
gate, the ferry just sails with empty seats that were paid for by nobody — which
is precisely why it needs a constraint rather than vigilance.

## Decision

Key on `(config_id, channel, owner_id)`. Drop funding source from the index, and
from the engine's `duplicate_owner_row` check, so the two layers agree.

## Consequences

- An owner's managed-ness becomes unambiguous per config: whichever row it has
  is the one it draws from.
- Migration `0003_one_row_per_owner.sql` replaces the looser index.
- **What the looser key allowed:** an owner holding a guaranteed contract from
  the operator *and* a separate managed entitlement. If that ever becomes a real
  requirement, the fix is not to loosen the index — it is to make managed-ness a
  property of the request that can select between the owner's rows, and to prove
  every row remains reachable.

## How it was found

Not by a test. By asking what "stranded" actually meant in a limitation I had
written down but never verified — and then measuring it.

The first measurement was wrong in a way worth recording: it compared reachable
seats against *cabin capacity*, which reported an operator who had allocated
only 90 of 100 seats as "stranding 10". Stranding has to be measured against the
**allocated partition**, not the physical ceiling. A second false positive came
from enumerating requesters only from rows present on the config, which reports
a partner pool as unreachable when no managed owner has a row — but drawing the
pool without an own row is exactly what the pool is for.

Two false positives and one real defect. The measure needed as much scrutiny as
the thing it measured.

## The property that now guards it

`leaves no allocated seat unreachable by every identity` drains every identity in
turn and asserts the committed total equals the allocated partition — neither
more (oversell) nor less (stranding). It was validated by temporarily denying
managed owners the partner pool, which made it fail and shrink to a one-seat pool
leaving 19 of 20 reachable.
