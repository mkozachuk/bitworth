# Asset Balancer (S-15) — Plan Brief

> Full plan: `context/changes/asset-balancer/plan.md`
> Research: `context/changes/asset-balancer/research.md`

## What & Why

Give the user a **"Balance"** page where they pick which of their existing (non-liability) assets form an investment set, assign a target % to each, and compare **declared** (target) vs **real** (current-value) allocation as two side-by-side pie charts — so they can spot drift and know what to rebalance. Separately, each assets-page row gains a calculated **"% of all assets"** label.

## Starting Point

The app already has assets (RLS-protected `assets` table, liabilities discriminated by `asset_categories.is_liability`), allocation primitives (`convertAmount`/`computeNetWorth` in `net-worth.ts`), a pure-helper + Vitest convention (`fire.ts`), Recharts (all `LineChart` so far), and a server-compute → presentational-island dashboard pattern. This plan adds one table, one helper, one route, one page (the first PieChart), and two edits to the assets list.

## Desired End State

A `/dashboard/balancer` page (new "Balance" nav item between Assets and FIRE) shows two pie charts over the selected non-liability assets, sharing one denominator and one per-asset color mapping; the user selects assets, enters targets with a live non-blocking "sum = X%" flag, and saves. Targets persist in a new `allocation_targets` table; de-selecting removes a row, deleting an asset cascades. Each non-liability assets-page row shows a muted "X% of all assets" sub-label.

## Key Decisions Made

| Decision                         | Choice                                                | Why (1 sentence)                                                                                       | Source |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| `target_pct` storage scale       | 0–100 `NUMERIC(5,2)` + `CHECK`                         | Matches the math layer's 0–100 scale; no ×100/÷100 conversion at the DB boundary.                       | Plan   |
| Write strategy                   | `.upsert(array, { onConflict: "user_id,asset_id" })`  | Single atomic statement per call; `UNIQUE(user_id, asset_id)` makes it idempotent.                      | Plan   |
| De-select handling               | Upsert submitted rows, then delete missing `asset_id`s | Set always matches what the user sees; no ghost slices in the declared pie.                             | Plan   |
| Declared-sum ≠ 100%              | Non-blocking, live flag; declared pie raw, real normalized | Keeps the two pies honest about under/over-allocation; matches roadmap guidance.                    | Plan   |
| "% of all assets" denominator    | Σ positive non-liability values; hide on liability rows | Every shown % is 0–100 and meaningful; avoids negative/>100% confusion.                                 | Plan   |
| `allocation.ts` return shape     | One structured object (totals + slices + declaredSum) | Single source of truth so both pies share denominator + color map; fully unit-testable.                | Plan   |

## Scope

**In scope:** `allocation_targets` table + RLS + migration; pure `allocation.ts` + tests; `GET`/`PUT` API route; `/dashboard/balancer` page + two-pie island + asset-picker/target editor; "Balance" nav item; per-asset "% of all assets" label on the assets list.

**Out of scope:** manual-override investment total; `show_balancer` settings toggle; hard-block on ≠100%; one-click normalize; liabilities in the set / label on liability rows; full-replace RPC; any new charting lib, Zod, or shared `formatPercent`.

## Architecture / Approach

Bottom-up: **data → math → API → page/UI → assets-label**. The page computes everything server-side in `.astro` frontmatter (assets join + `getRates` + saved targets → `allocation.ts`) and feeds flat props to a `client:load` Recharts island. `allocation.ts` returns one ordered slice list so both pies share the denominator and the `--chart-1..5` color mapping. The save endpoint does upsert-then-delete-missing under the standard two-guard auth + hand-rolled validation conventions.

## Phases at a Glance

| Phase                          | What it delivers                                          | Key risk                                                       |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Data layer                  | `allocation_targets` table + RLS + regenerated types     | RLS/cascade/unique constraint must all be correct             |
| 2. Allocation math             | Pure `allocation.ts` + Vitest suite                      | ×100/÷100 scaling bugs; near-zero denominator handling        |
| 3. API route                   | `GET`/`PUT` with upsert + delete-missing                 | Empty-`in` edge case when clearing the set                    |
| 4. Balance page + charts + nav | First PieChart island, picker/editor, "Balance" nav      | Both pies must share denominator + color map; react-compiler  |
| 5. Per-asset label             | "% of all assets" sub-label, hidden on liabilities       | Single clear denominator; hide on liability rows              |

**Prerequisites:** F-01 (table pattern), S-01 (assets + list), S-02 (`convertAmount`/`computeNetWorth` + Recharts) — all present. Local Supabase running for the migration.
**Estimated effort:** ~2–3 sessions across 5 phases (Phase 4 is the largest).

## Open Risks & Assumptions

- Both pies diverging on denominator/color is the headline correctness risk — mitigated by the single structured `allocation.ts` result driving both.
- `.in(...)` negation with an empty submitted list needs an explicit "clear all" branch (handled in Phase 3).
- No automated API integration harness exists; Phase 3 correctness rests on manual verification.

## Success Criteria (Summary)

- User can select assets, set targets, save, reload, and see persisted declared + real pies that share colors and denominator.
- De-selecting/deleting assets never leaves orphan or ghost target rows.
- Each non-liability assets-page row shows a 0–100% share; liability rows show none; non-liability shares sum to ~100%.
