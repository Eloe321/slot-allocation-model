# ADR-0012 — Cutoff preserves the partition, so the constraints stay armed

## Context

At the booking cutoff, unsold capacity is consolidated onto the counter.
`flexible` children and direct online/marketplace rows give up their free
portion; `guaranteed` children keep theirs.

The obvious implementation is `movable = allocated − sold − held`, credited to
the counter.

## The problem

It oversells, twice over. Cabin capacity 100:

```
counter    direct       10
online     direct       90  (5 sold)
agency#a   flexible     20  (3 sold)   funded from online
agency#b   guaranteed   15  (2 sold)   funded from online
```

1. The online parent's *raw* free portion is 85 — but 35 of that is held by its
   children. Releasing 85 hands the same seats to two places.
2. When the flexible child releases 17, that headroom **already returns to its
   parent**. Crediting the counter as well counts it a second time.

Result: `counter 112, online 5` — direct allocations summing to 117 on a
100-seat cabin, and 135 reachable seats.

## Decision

Release the **netted** free portion, and decrement the funding parent by
whatever a child returns:

```
movable(r) = allocated − own_children − sold − held

child releases X:  child.allocated  −= X
                   parent.allocated −= X
                   counter          += X
```

The same fixture then yields `counter 77, online 23` — and 23 is exactly
`children(18) + sold(5)`, the parent sitting precisely on its ceiling.

## Consequences

- Direct allocations still sum to cabin capacity after cutoff, and every parent
  lands exactly on its ceiling. Post-cutoff state satisfies **every** invariant
  unchanged.
- Therefore the database constraints need **no cutoff exemption**. The original
  design required the pool-ceiling triggers to stand down after cutoff, because
  its cutoff genuinely did drain a parent below its children. Ours does not, so
  the triggers stay armed through the single operation that rewrites the most
  rows.
- That the cutoff transaction **commits** is itself the proof the algorithm is
  right. The naive version would be rejected by the trigger.
- The same `nettedAvailable` function serves the cutoff sweep, the display path
  and the waterfall, so they cannot disagree about what "free" means.
- **What the exemption bought:** tolerance of a cutoff that does not preserve the
  partition. That is not a property worth having, and disarming a safety
  constraint during the riskiest operation is precisely backwards.
