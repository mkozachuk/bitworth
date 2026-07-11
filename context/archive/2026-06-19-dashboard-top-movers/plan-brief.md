# Dashboard Top Movers — Plan Brief

> Full plan: `context/changes/dashboard-top-movers/plan.md`

## What & Why

Replace the dead "Your assets will appear here" placeholder on the dashboard with a **Top Movers** panel — which assets rose and fell the most since the user's last snapshot, as top gainers + top losers (amount + %), plus a "new since snapshot" note. It turns the per-asset `snapshot_items` (captured at every snapshot but never read until now) into a real insight, and is the read+matching foundation that S-12 per-asset trends will reuse.

## Starting Point

The dashboard already renders `NetWorthDisplay`, `AssetsSummary`, and `NetWorthChart`, then a static placeholder card (`dashboard.astro:72-84`). Snapshots are loaded ascending; each snapshot's `snapshot_items` store `name`, `category_id`, `original_amount`/`original_currency`, and a frozen `converted_amount` — but there is no `asset_id` and no `is_liability`, so this is the first feature that has to match assets across the snapshot boundary by `(name, category_id)`.

## Desired End State

In the placeholder's slot: a Top Movers panel with up to 3 gainers and 3 losers (category emoji, name, signed amount, signed %), ranked by absolute net-worth-contribution change, with a "New since snapshot" line for assets added since the baseline. No snapshot yet → a friendly "save a snapshot" prompt. The diff logic lives in a pure, unit-tested `src/lib/movers.ts`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Liability handling | Signed net-worth contribution | Movers mean "what moved your net worth"; a shrinking debt is a gainer | Plan |
| New assets (no baseline) | Show in a small "New since snapshot" note | Surfaces new holdings without faking a 100% gain | Plan |
| Baseline currency basis | Re-convert `original_amount` at today's rates | Both sides share one currency + rate set; robust to a display-currency switch | Plan |
| Row content & ranking | Amount + %, ranked by absolute amount | Mirrors `DeltaIndicator` format; absolute rank surfaces biggest money moves | Roadmap (S-11) |
| Near-zero baseline % | Show amount, suppress % as "—" | No Infinity/NaN reaches the UI; amount stays meaningful | Plan |
| Placement | Replace placeholder div; drop "Manage assets" link | Single clean panel focused on movers | Plan |
| Movers count | Top 3 gainers + 3 losers | Roadmap default; degrades gracefully | Roadmap (S-11) |
| Match key | `(name, category_id)` | No `asset_id` exists; cheapest stable identity | Roadmap (S-11) |
| Read path | Server-load in `dashboard.astro`, no new API | Consistent with existing snapshots load | Roadmap (S-11) |

## Scope

**In scope:** pure `movers.ts` + tests; latest-snapshot `snapshot_items` query in `dashboard.astro`; `TopMovers` island replacing the placeholder; gainers/losers/new-assets + no-snapshot empty state.

**Out of scope:** new API endpoint; schema change / `asset_id` / unique constraint; per-asset trend chart (S-12); surfacing removed assets; client-side rates fetch in the island; any change to the snapshot write path.

## Architecture / Approach

`dashboard.astro` loads current `assets` (with category) and the latest snapshot's `snapshot_items` (with category join), plus `displayCurrency` and server `rates` → passes all to `<TopMovers client:load>`. The island calls `computeMovers(current, baseline, displayCurrency, rates)`: builds a `(name, category_id)` map of signed baseline contributions, diffs each current asset against it (both converted at today's rates), partitions by sign with an epsilon dead-zone, ranks by `|change|`, slices top 3. Unmatched current assets → `newAssets`. Rendering reuses the `DeltaIndicator` idiom and `categoryEmoji`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. movers.ts + tests | Pure, table-driven diff/ranking function | `(name, category_id)` matching + signed/liability/near-zero-% math correctness |
| 2. Dashboard wiring + island | Latest-snapshot query + `TopMovers` replacing the placeholder | Edge states (no snapshot / new asset / currency change) must render, not crash |

**Prerequisites:** F-01, S-01, S-02, S-04 — all done. Vitest is already set up (`net-worth.test.ts`, `fire.test.ts`).
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- `(name, category_id)` matching is fragile: renaming an asset reads as remove+add (the renamed one becomes "new"). Accepted — no stable `asset_id` exists, and the "new since snapshot" note absorbs it gracefully.
- Re-converting the baseline at today's rates means per-asset change reflects holding changes, not the rate movement between snapshots — a deliberate divergence from the net-worth `DeltaIndicator`, chosen for currency-switch robustness.
- Float math is epsilon-guarded (`1e-2`) for both the %-suppression and the no-change dead-zone.

## Success Criteria (Summary)

- A user who saved a snapshot then changed asset values sees correct top gainers/losers (right sign, amount, %), with liabilities handled in net-worth terms.
- A user with no snapshot sees a friendly prompt, never a crash or empty card.
- New assets show only under "New since snapshot"; a display-currency switch doesn't produce a wrong comparison.
