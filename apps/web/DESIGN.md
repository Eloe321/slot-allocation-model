# Design

## Theme

Light, high-contrast, near-monochrome. The scene: a reviewer reading dense
numeric content in a bright browser tab among twenty others. Dark was rejected
as the category reflex for developer tooling, not on taste.

Mood: **a surveyor's field notebook** — ruled paper, precise ink, measurements
that have to be trusted. Instrument, not dashboard.

## Color

Strategy: **Restrained.** One brand colour, used only for available capacity and
primary action. Everything else is ink and rule. Colour never decorates.

Ground is literal `#ffffff`. The brand hue carries the character; the surface
stays out of the way. Panels sit on a barely-tinted neutral so they read as
separate planes without borders doing all the work.

```
--bg          oklch(1.000 0.000 0)        pure white, no hidden warmth
--surface     oklch(0.985 0.003 280)      panel plane
--rule        oklch(0.900 0.006 280)      hairlines, table rules
--ink         oklch(0.220 0.015 280)      body and data
--ink-muted   oklch(0.470 0.012 280)      labels, secondary (4.5:1 on bg)
--primary     oklch(0.420 0.130 280)      free capacity, primary action
```

The primary is a deep ink-violet, not the bright indigo the seed's first read
suggests — bright indigo on white with soft cards is the Linear-clone answer
this project explicitly avoids.

### Capacity semantics

The only colour vocabulary in the product. Each segment also carries a distinct
fill pattern and a label, so state never depends on hue alone.

```
--cap-free    oklch(0.420 0.130 280)   solid       genuinely bookable
--cap-held    oklch(0.620 0.140 065)   diagonal    transient, TTL will return it
--cap-sold    oklch(0.380 0.020 280)   solid dark  committed, immovable
--cap-carved  oklch(0.760 0.010 280)   hatched     claimed by a child row
```

`--cap-carved` is the one that matters. It is the difference between a parent's
raw availability and its netted availability, drawn rather than described.

## Typography

One family in two roles. `ui-sans-serif` system stack for prose and labels;
`ui-monospace` for every number, with `font-variant-numeric: tabular-nums` so
digits align down a column and can be compared by eye.

Fixed rem scale, ratio ~1.2. No fluid clamp headings — this is product UI viewed
at consistent DPI.

```
--text-xs  0.75rem    --text-sm  0.8125rem   --text-base 0.875rem
--text-md  1rem       --text-lg  1.25rem     --text-xl   1.5rem
```

Data is set at `--text-base` or larger. Labels may go to `--text-xs` but never
below, and never in tracked uppercase as a section eyebrow.

## Layout

Two columns on wide screens: the tree on the left (it is the subject), controls
and trace on the right. Single column below 900px, tree first.

Spacing scale in rem: 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3. Rhythm varies by
section; panels are separated by rule lines rather than by shadow or card
elevation.

The tree scrolls inside its own container. The page body never scrolls
horizontally, including at 360px.

## Components

Panels are plain regions with a heading and a hairline, not cards. No nested
cards anywhere. Controls use native elements — `select`, `input[type=number]`,
`button` — restyled minimally, because reinventing standard affordances is a
product-register ban and buys nothing here.

Every interactive element defines default, hover, focus-visible, active and
disabled. Focus rings are 2px, offset, and meet 3:1 against adjacent colour.

## Motion

150ms on state transitions only: capacity bars resizing when a reservation
lands, a row highlighting when the waterfall selects it. Nothing on page load.
Under `prefers-reduced-motion: reduce`, transitions become instant — the state
change still happens, it just does not animate.
