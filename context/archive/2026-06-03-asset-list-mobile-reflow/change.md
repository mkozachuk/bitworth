---
change_id: asset-list-mobile-reflow
title: AssetList mobile reflow
status: archived
created: 2026-06-03
updated: 2026-07-11
archived_at: 2026-07-11T20:55:40Z
---

## Notes

Sourced from @context/foundation/roadmap.md (S-07, status: planned).

Goal: user can read every asset, switch between All / Assets / Liabilities, and trigger Edit or Delete on a phone-sized viewport (~360px wide) without horizontal scrolling.

Open questions to resolve during /10x-plan:
- Pure-CSS table reflow (`block sm:table` + stacked cells) vs. conditional render of a separate card component on `<sm`. Recommendation: conditional render — keeps desktop `<table>` markup untouched.
- Filter tabs (All / Assets / Liabilities) — keep as-is or apply mobile treatment in this slice? Recommendation: leave unless quick check shows overflow.
- Empty state ("No assets yet" / "No {filter} found") — keep one or split mobile/desktop? Recommendation: keep one.

Risks noted in roadmap:
- Visual regression on desktop if markup changes — keep `<table>` path for `≥sm` byte-identical; only add a separate mobile view.
- a11y — swap between `<table>` and a card list must preserve semantic structure. Use `<ul>` + `<li>` for the mobile view (it's a list of items, not tabular data on narrow screens), keep `<table>` for desktop.
