# ADR-0002 — Compute netted availability at read time

## Context

A parent's real availability is `allocated − children − sold − held`. Something
has to compute it. The alternative is to store it.

## Options

**A. Compute on every read** from the rows already loaded.
**B. A materialized `effective_available` column**, updated by trigger.
**C. A database view** that computes it in SQL.

## Decision

**A.** `nettedAvailable(row, allRows)` is a pure function called by the display
path, the waterfall, and the cutoff sweep.

## Consequences

- One definition. A stored column can drift from the rule that produced it; a
  view can drift from the engine. Here there is nothing to drift.
- The reservation path already holds every row of the config under lock, so the
  inputs are in memory anyway. The computation is a sum over a handful of rows.
- **What B would have been better at:** querying availability across many
  configs at once — a "which sailings still have seats" screen would need a
  scan today. That query does not exist yet, and inventing a denormalization for
  a hypothetical reader is how correctness bugs get introduced.
