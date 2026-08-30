# Product

## Register

product

## Users

Technical reviewers — hiring engineers and prospective freelance clients —
giving this between ninety seconds and an hour, usually in a browser tab among
twenty others. They are not operating a ferry. They are judging whether the
author can reason about hard, stateful correctness problems.

The job to be done: understand *why* partitioned capacity is difficult, and see
that this implementation handles it, without reading source code.

## Product Purpose

An inspector for a slot-allocation engine. It makes three normally-invisible
things visible:

1. The allocation **tree** — capacity partitioned among sales channels, where a
   child row is a claim staked inside its parent rather than extra seats.
2. The **netting divergence** — a parent advertising 65 free seats when only 30
   are real. This is the bug the whole system exists to prevent, and seeing the
   two numbers side by side is the single most important thing on the page.
3. The **waterfall** — how one identity resolves to an ordered list of rows, and
   why each candidate was included or skipped.

Success: a reviewer who never opens the repository still understands the model
and believes the implementation is careful.

## Brand Personality

Precise, quiet, unhurried. A measuring instrument, not a product tour. It states
numbers and lets them carry the argument. Nothing is decorated; nothing is sold.

Three words: exact, legible, unshowy.

## Anti-references

- **Marketing landing page.** No hero headline, no feature bullets, no
  call-to-action. Wrong register entirely for an inspection tool.
- **Terminal-dark developer tool.** Black ground, neon green, monospace
  everything. It is the reflex answer for this category, which is precisely why
  it reads as unconsidered rather than as a decision.
- **Linear-clone productivity indigo.** The second-order trap: having avoided
  terminal-dark, the obvious next move is bright indigo on white with a soft
  card grid. Avoided deliberately.
- The shared bans apply: no gradient text, no glassmorphism, no hero-metric
  template, no identical card grids, no tracked-uppercase eyebrow above every
  section.

## Design Principles

1. **The numbers are the interface.** Chrome recedes; data is the largest,
   highest-contrast thing on screen. Tabular figures throughout so columns of
   digits align and can be compared down a column.
2. **Colour is information-bearing only.** Capacity state — free, held, sold,
   carved-out-by-children — is the data. Any colour that does not encode state
   competes with meaning and is removed.
3. **Show the mechanism, don't assert it.** Where a rule matters, render the
   thing itself: the carved-out portion of a parent's bar is drawn, not
   described. Divergence is displayed, not captioned.
4. **Every number comes from the API.** The browser contains no allocation
   arithmetic. A second implementation could drift and quietly tell a different
   story than the engine.
5. **Refusals are results.** A shortfall renders as its numbers, not as an error
   toast. Being told "20 available, you asked for 9999" is the interesting part.

## Accessibility & Inclusion

- WCAG 2.2 AA. Body text ≥ 4.5:1; large text ≥ 3:1.
- **State is never encoded by hue alone.** Every capacity segment carries a
  distinct fill pattern and a text label as well as a colour, so the tree stays
  readable with any form of colour blindness and in greyscale print.
- Full keyboard operation; visible focus rings that meet 3:1 against adjacent
  colour.
- `prefers-reduced-motion` honoured: transitions become instant, never removed
  in a way that hides a state change.
- The page must not scroll horizontally at 360px. Wide content scrolls inside
  its own container.
