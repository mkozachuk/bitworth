---
change_id: dashboard-top-movers
title: Dashboard top movers — gainers/losers since the last snapshot
status: archived
created: 2026-06-19
updated: 2026-07-11
archived_at: 2026-07-11T20:55:40Z
---

## Notes

Seeded from `context/foundation/roadmap.md` → **S-11: Dashboard top movers**.

- **Outcome:** in place of the empty "Your assets will appear here" placeholder, show a top-movers panel on the dashboard — which assets rose and fell the most since the last saved snapshot — top gainers + top losers side by side with amount and percentage; when there is no snapshot to compare against, a friendly placeholder prompts saving one.
- **Prerequisites:** F-01, S-01, S-02, S-04 (all done). Parallel with S-12.
- **Comparison basis:** current live asset values (converted at today's rates) vs the `converted_amount` stored in the most recent snapshot's `snapshot_items` — mirrors the existing delta indicators (mixed-rate caveat on the live side).
- **Asset identity:** `snapshot_items` has no stable `asset_id` — match current assets to latest snapshot items on `(name, category_id)`; unmatched current assets are "new" (no baseline); unmatched snapshot items are removed/absent.
- **Count:** top 3 gainers + top 3 losers, ranked by absolute change; "no change" / single-asset / no-snapshot states degrade gracefully.
- **Read path:** load latest snapshot's `snapshot_items` server-side in `dashboard.astro` (consistent with existing snapshots load) and pass to a new `TopMovers` React island replacing the placeholder `<div>`.
- **Risk:** first-ever consumer of `snapshot_items`; `(name, category_id)` matching is fragile across renames. Mitigant: isolate diff into a pure, unit-tested `src/lib/movers.ts`; reuse `DeltaIndicator` sign/colour pattern and `convertAmount` from `src/lib/net-worth.ts`. Empty/single/no-snapshot must render the placeholder, not crash.
