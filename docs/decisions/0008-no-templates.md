# ADR-0008 — Leave out templates, versions and trip snapshots

## Context

The original derives each trip's allocation from a versioned template: an
operator edits a reusable layout, every edit creates an immutable version, and a
trip pins the version it was created from.

## Decision

Configs are created directly, from seeded scenarios.

## Consequences

- Version pinning is a good idea and worth naming: editing a template must not
  silently mutate trips already selling. But implementing it is CRUD plus a
  foreign key, and it sits *upstream* of the allocation problem rather than
  inside it.
- The free-for-all rule survives, because it is a waterfall rule rather than a
  template rule: a config that is a single unowned online row serves every
  channel.
- **What including it would have shown:** immutability discipline and a
  migration story. Both are worth demonstrating; neither is what this repository
  is about, and both would have added more code than the engine itself.
