# Allocation Drift Card Restyle — Plan Brief

> Full plan: `context/changes/dashbord-drift-restyle/plan.md`

## What & Why

The dashboard's **Allocation Drift** card currently lists offending assets as raw prose ("Bonds +37pp over target", "VWCE.DE −22pp under target"). We're restyling it into a visual, friendly card — a diverging target bar per asset plus a "current → target" label — so a user can see at a glance which holdings have drifted, in which direction, and how far, without parsing text.

## Starting Point

`DriftAlerts.tsx` is a purely presentational React island rendering text rows of `name + formatDrift(drift)`. The drift math (`computeDrift` in `allocation.ts`) already computes each asset's current weight (`realPct`) and target weight (`normalizedTargetPct`), but `dashboard.astro:212` drops both, passing only the signed pp `drift`. The FIRE card (`FireProgress.tsx`) already has a progress-bar idiom with proper a11y and reduced-motion to mirror.

## Desired End State

Each of the up-to-3 worst offenders renders as a horizontal diverging bar (center = target; fill right = over, left = under; length ∝ drift), an amber severity accent, a Lucide direction arrow, and a friendly "12% now · 5% target · 7pp over" label. The worst-card heading, "Also drifting" line, proportional-targets note, and "Review in balancer" CTA all remain, restyled. Full dark-mode + reduced-motion support. Gating (5pp threshold, `show_drift_alerts` pref) is unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Visual metaphor | Diverging target bar | Shows direction + magnitude at a glance, reuses the FireProgress bar idiom | Plan |
| Data shown | Friendly gap + current→target | Answers "where am I vs where should I be"; data already computed, just dropped | Plan |
| Color semantics | Neutral + amber severity | Over-target is a deviation, not a gain — green/red would mislead | Plan |
| Direction cue | Subtle per-row Lucide arrows | Redundant, accessible direction signal beyond color/position | Plan |
| Secondary content | Keep all, restyle | The name, "also drifting", and ≠100 note carry real context | Plan |
| Phasing | Data-threading, then visual | Isolates trivial plumbing from iterative visual work | Plan |

## Scope

**In scope:** widen `DriftOffender` props + `dashboard.astro:212` mapping to carry `realPct`/`normalizedTargetPct`; rebuild the offender rows as diverging bars with labels + arrows + amber palette; restyle surrounding content.

**Out of scope:** drift math, the Supabase query, threshold/gating, a reusable UI primitive, charting, new interactivity, sibling-card layout.

## Architecture / Approach

Single-component change plus a one-line data-threading widening. The card stays a server-fed presentational island: `dashboard.astro` computes drift and now passes the current/target weights; `DriftAlerts.tsx` renders a local `DriftBar` subcomponent per offender, mirroring `FireProgress`'s track/fill/a11y/reduced-motion pattern. A clamped |drift| → half-width map keeps extreme drifts inside the track.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Thread weights through boundary | `realPct`/`normalizedTargetPct` available at the island; no visual change | Trivial — compiler-verified |
| 2. Restyle the card | Diverging bars, labels, arrows, amber palette, restyled secondary content | Bar geometry clamp + dark-mode/contrast legibility |

**Prerequisites:** an account with a balancer card breaching the 5pp drift threshold (or adjustable targets to force one) for manual verification.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Bar clamp must saturate large drifts (e.g. +37pp) so the fill stays within the rounded track — the one bit of real geometry to get right.
- Amber severity accent must read as "attention" in both light and dark mode without implying good/bad; contrast to be confirmed manually.
- Assumes the top-3-offenders / worst-card selection stays as-is (it does).

## Success Criteria (Summary)

- Each offender's drift direction and severity is readable at a glance from the bar + arrow, with a current→target label.
- Color never implies over-target is "good"; dark mode and reduced-motion both behave.
- `typecheck`, `lint`, and `build` all pass; no regression to sibling cards or the card's gating.
