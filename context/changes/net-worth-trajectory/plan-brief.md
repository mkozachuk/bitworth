# Empirical Net-Worth Trajectory — Plan Brief

> Full plan: `context/changes/net-worth-trajectory/plan.md`

## What & Why

Give users a data-driven projection of their future net worth, fitted to their **real saved snapshots** rather than assumptions — a dotted continuation of the existing dashboard net-worth chart plus a plain-language "at your current pace you'll reach €X by <date>" readout and, given a target, an estimated hit-date. It's the empirical counterpart to the assumption-based FIRE calculator (S-09): "given what actually happened, when?".

## Starting Point

The dashboard already renders a Recharts net-worth line chart (`NetWorthChart.tsx`) from raw snapshot rows, and already uses dashed strokes and mixed-currency detection. Pure, table-tested math libs (`fire.ts`, `monte-carlo.ts`) and a settings-gate chain (`show_fire_dashboard`) are established patterns to mirror. No projection exists today.

## Desired End State

A user with ≥2 comparable snapshots sees their solid history continue as a muted dotted projected line, a linear/CAGR toggle, an ephemeral target input with an ETA readout, and an "estimate, not financial advice" disclaimer — hideable via a new default-on settings toggle. The isolated `etaToTarget` helper also unblocks S-21 (savings-goals).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Surface / placement | Inline on the dashboard chart | Matches the roadmap's "dotted continuation of the existing chart"; no new page/nav | Plan |
| Target-ETA input | Ephemeral (client-side, not persisted) | Smallest scope; S-21 owns persisted named goals and reuses this `etaToTarget` | Plan |
| Fit model | Both (linear + CAGR), toggle, default linear | Linear is most legible/least over-promising; CAGR available on demand; both tested | Plan |
| Projection horizon | Match history span, capped at 5 years | Projection length scales with evidence, mitigating misleading extrapolation | Plan |
| Settings gating | Gate behind `show_trajectory` (default on) | Consistent with the FIRE/drift card precedent; user can hide it | Plan |
| Uncertainty framing | Point projection + disclaimer only | Roadmap defers the residual band past v1; avoids false precision | Plan |
| CAGR edge handling | Requires positive endpoints; else `null` + toggle disabled | log of ≤0 is undefined; never render a bogus exponential; linear always works | Plan |

## Scope

**In scope:** pure `trajectory.ts` (linear + CAGR fit, `projectForward`, `etaToTarget`) + tests; dotted projected line on `NetWorthChart`; model toggle; ephemeral target/ETA readout; disclaimer; `show_trajectory` settings gate (schema → API → settings → dashboard); ≥2-comparable-snapshot and mixed-currency suppression states.

**Out of scope:** persisted/named savings goals (S-21); uncertainty band; dedicated trajectory page; new charting lib; SSR precompute; any new snapshot writes.

## Architecture / Approach

All trajectory math is a pure lib called **client-side in the chart island** from the same `snapshots` prop the chart already receives (no SSR compute needed). The island computes both fits, projects forward over an evidence-scaled horizon, appends `projected` points to the Recharts data, and renders a second dashed `<Line>` plus reactive target/ETA controls. A new `show_trajectory` boolean threads through the standard preferences chain to gate visibility.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Trajectory math lib + tests | `src/lib/trajectory.ts` + exhaustive Vitest tables | Fit correctness / FP scaling — mitigated by oracle tests + 333.33 probe |
| 2. `show_trajectory` settings gate | Schema → types → API → settings → dashboard read | Fragmenting the prefs write path — mitigated by cloning the `show_fire_dashboard` chain exactly |
| 3. Chart projection + readout UI | Dotted line, toggle, target/ETA, disclaimer, edge states | Misleading extrapolation / joining solid↔dotted line — mitigated by muted dashed styling, capped horizon, currency-segment guard |

**Prerequisites:** F-01 + S-02 (both done — snapshots, `NetWorthChart`, Recharts, net-worth math all exist).
**Estimated effort:** ~2-3 sessions across the 3 phases; Phase 1 is the bulk of the testing, Phase 3 the bulk of the UI.

## Open Risks & Assumptions

- A short or volatile snapshot history can still produce a confident-looking line; mitigated by the ≥2-comparable floor, evidence-capped horizon, muted dashed styling, and disclaimer — but the projection is inherently naive by design.
- Mixed-currency history is handled by fitting only the trailing same-currency segment; a user who switches currencies frequently may often see the projection suppressed. Acceptable for v1.
- Assumes local Supabase is available to apply the additive migration during Phase 2.

## Success Criteria (Summary)

- A user with real snapshot history sees an honest, visually-distinct forward projection and a sensible pace/target readout on the dashboard.
- The projection can be hidden via Settings and is suppressed (not faked) when history is insufficient or non-positive for CAGR.
- `etaToTarget` is a clean, tested helper ready for S-21 to reuse.
