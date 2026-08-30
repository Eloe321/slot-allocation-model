# ADR-0005 — Record which row each sold seat came from

## Context

When a booking is cancelled, its seats must go back. The system has to know
where "back" is.

## Options

**A. Re-derive** from the booking's channel by re-running the waterfall.
**B. A durable `booking_slot_links` row per split**, written at confirmation.

## Decision

**B.** Confirmation writes one link per split, and release reads the links.

## Consequences

- Correct when the waterfall drew from several rows. Re-deriving would return
  all 25 seats to whichever row the waterfall picks *today* — but they came from
  three different rows, and the tree has changed since.
- Correct when the tree changed after the sale. An agency's allocation may have
  been resized, or cutoff may have moved capacity to the counter. The link
  records history; the waterfall only knows the present.
- **What A would have been better at:** no extra table, no extra write, and no
  possibility of links disagreeing with counters. It is wrong for a reason worth
  stating plainly: **the booking's declared channel is not the same fact as the
  rows its seats came from**, and only the second one can be reversed.
