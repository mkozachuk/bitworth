# Per-Asset Trend Charts — Plan Brief

> Full plan: `context/changes/per-asset-trends/plan.md`
> Research: `context/changes/per-asset-trends/research.md`

## What & Why

Build per-asset trend lines from snapshot history (S-12). Each asset gets an opt-in "Show on chart" flag on the add/edit form; the dashboard gets a separate **Asset Trends** chart (below Net Worth) with a master toggle that reveals only opted-in assets. A separate chart is needed because individual asset lines collapse to a flat band when overlaid on the net-worth sum; an absolute⇄% (indexed) sub-toggle further keeps assets of very different sizes legible.

## Starting Point

Snapshot history already captures everything needed (`snapshot_items` carry `name`, `category_id`, `original_amount`, `original_currency`) — but there's no `asset_id`, so cross-snapshot identity is `(name, category_id)`, exactly as `movers.ts` already does. Today the dashboard loads only the latest snapshot's items, and `assets` has no chart flag.

## Desired End State

The asset form has a "Show on chart" checkbox persisting to `assets.show_on_chart`. The dashboard shows a hidden-by-default Asset Trends card; a header toggle reveals indexed-by-default lines for opted-in assets, each color-distinct with a legend. Edge cases render honestly (broken lines for gaps, no line for zero baselines, natural-direction liabilities).

## Key Decisions Made

| Decision                     | Choice                                      | Why (1 sentence)                                                              | Source   |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Presentation                 | Separate chart, not overlaid                | Asset lines collapse against the net-worth sum on a shared axis.             | Research |
| Indexed sub-toggle           | Absolute ⇄ % (rebase to 100)                | Mismatched asset sizes flatten the small ones even in a separate chart.      | Research |
| Per-asset flag               | `show_on_chart` boolean, default false      | Opt-in set the dashboard toggle reveals; minimal additive column.           | Research |
| Master toggle                | Ephemeral, client-only, default OFF         | No DB column this slice; persistence is an easy follow-up.                   | Research |
| Identity                     | `(name, category_id)`                       | No `asset_id` on snapshots; reuse `movers.ts` matching.                      | Research |
| Mid-series gaps              | Null hole (line breaks)                     | Honest — shows the asset wasn't held then; zero extra math.                  | Plan     |
| Liabilities in % mode        | Rebase index on `Math.abs(baseline)`        | Keeps signed semantics in absolute mode; natural direction in indexed.      | Plan     |
| >5 lines                     | Generate distinct HSL palette helper        | Every line visually unique without a soft cap.                              | Plan     |
| Default mode when shown      | Indexed (%)                                 | The readability problem indexed mode solves is the headline question.       | Plan     |
| Control placement            | Both toggles in the card header row         | Self-contained card; controls adjacent to what they affect.                 | Plan     |
| All-snapshots query          | Nested select off `snapshots`               | One round trip; attaches each item to its parent's date.                    | Plan     |

## Scope

**In scope:** `show_on_chart` column (migration → types → form → POST/PUT → tests); pure `buildAssetTrends` builder + HSL palette helper (unit-tested); `AssetTrendsChart` island with master + mode toggles, legend, edge-state placeholders; all-snapshots query + dashboard mount.

**Out of scope:** Master-toggle persistence; overlay on Net Worth chart; rename/category-move stitching; carry-forward/interpolation across gaps; soft cap for many lines; any snapshot write-path change.

## Architecture / Approach

Server (`dashboard.astro`) loads assets, rates, and all snapshot items via one nested query and passes them as props. The pure `src/lib/asset-trends.ts` builder groups items by `(name, category_id)`, computes signed values via `movers.ts`'s `contribution()` (converting at today's rates), and attaches a per-line indexed value. The `AssetTrendsChart` island is presentational — it filters to opted-in assets, shapes Recharts rows, and renders lines/legend/toggles using the `NetWorthChart` recipe.

## Phases at a Glance

| Phase                              | What it delivers                                  | Key risk                                              |
| ---------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| 1. `show_on_chart` flag            | Opt-in settable + persisted end-to-end            | Unchecked-checkbox FormData gotcha (hidden mirror)    |
| 2. Builder + palette helper        | Pure, unit-tested series math + colors            | Edge-case correctness (indexing, liabilities, gaps)   |
| 3. Chart island + wiring           | Asset Trends card on dashboard                     | Recharts null-hole / legend keying / empty states     |

**Prerequisites:** Local Supabase running for the migration; existing `movers.ts`/`net-worth.ts`/`exchange-rates.ts` helpers.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- Rename / category-move = line discontinuity (no `asset_id` to stitch) — accepted limitation, same as S-11.
- HSL palette must stay legible on both light and dark backgrounds — fixed saturation/lightness chosen for both; verify manually in Phase 3.
- Liability sign in indexed mode can confuse if a liability and asset sit at the same % — tooltip/legend must surface the sign.

## Success Criteria (Summary)

- Toggling the asset flag and the dashboard master toggle draws exactly the opted-in lines, indexed by default.
- Liabilities, gaps, zero-baselines, and empty states all render honestly without crashing.
- No regression to the Net Worth chart or Top Movers; build, lint, and unit suite pass.
