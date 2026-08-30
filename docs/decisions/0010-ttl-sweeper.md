# ADR-0010 — Return expired holds with a sweeper, not lazily on read

## Context

A checkout hold has a TTL. When it lapses, the seats must become available
again.

## Options

**A. Lazy expiry** — treat lapsed holds as free whenever a row is next read.
**B. A scheduled sweeper** that releases them and writes the ledger entry.

## Decision

**B.** A job every ten seconds finds lapsed open holds and releases them.

## Consequences

- Expired capacity becomes visible to *every* reader, not only to whoever
  happens to touch that row next. A sailing nobody queries would otherwise
  strand its seats indefinitely — the failure mode is invisible, which is the
  worst kind.
- The ledger gets an `expire_hold` entry, so the counters always have an
  explanation. Under A the seats would silently reappear with no record.
- The sweeper re-reads holds under the lock, because a token may have been
  confirmed or released between the scan and acquiring the lock.
- **What A would have been better at:** no background process, and no window
  where a lapsed hold still counts. The window here is bounded by the sweep
  interval and never causes an oversell — it only under-reports availability
  briefly, which is the safe direction to be wrong in.
