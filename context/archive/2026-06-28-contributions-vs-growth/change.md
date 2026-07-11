---
change_id: contributions-vs-growth
title: Split each snapshot-to-snapshot net-worth change into contributions vs market growth
status: archived
created: 2026-06-28
updated: 2026-07-11
archived_at: 2026-07-11T20:55:40Z
---

## Notes

Roadmap slice **S-17** (`context/foundation/roadmap.md`).

**Outcome:** user sees how much of each snapshot-to-snapshot change in net worth came from money they added (contributions) vs market movement (growth) — e.g. a stacked bar per interval where `contribution + growth = total change`.

**Prerequisites:** F-01, S-01, S-02 (snapshot history + `convertAmount`/`computeNetWorth` in `src/lib/net-worth.ts` + Recharts), S-05 (display currency); reuses S-11/S-12 snapshot-read + `(name, category_id)` patterns.

**Key unknowns / planner decisions:**
- **Contribution capture (core unknown).** Schema carries no contribution/quantity data, so growth can't be inferred. Recommended v1: nullable `net_contribution NUMERIC(18,2)` column on `snapshots` (mirror the `show_on_chart` / `fire_*` column-add migration pattern), entered via an optional "money added since last snapshot" field on the snapshot-save flow. Per-interval: `growth = (NW_t − NW_{t−1}) − net_contribution`.
- **Missing data.** Old snapshots / intervals without a recorded contribution must render an "unknown split" / growth-only state — never crash or mislabel.
- **Currency.** Store the contribution in the snapshot's `display_currency` at entry time; document the cross-currency caveat (same family as the existing mixed-rate snapshot caveat).
- **Presentation.** New stacked-bar chart with Recharts (do NOT add a new lib) under the net-worth chart. Isolate per-interval math in a pure, unit-tested `src/lib/contributions.ts`, reusing `convertAmount` and the signed-`contribution()` convention from `src/lib/movers.ts`.
- **Scope guard.** No savings-rate metric (needs income tracking the app lacks) — keep v1 to the contributions-vs-growth split only.
