<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Per-Asset Trend Charts

- **Plan**: context/changes/per-asset-trends/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-06-19
- **Verdict**: APPROVED
- **Findings**: 0 critical · 0 warnings · 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated success criteria re-run at review time: `npm run build` ✅, `npm run lint` ✅ (clean), `npx vitest run` ✅ (112/112). Manual checks (3.4–3.10) verified against the running app via a throwaway Playwright drive (seeded 4-snapshot history; screenshots of indexed + absolute modes).

Unplanned files, both forced mechanical consequences of the Phase-1 type change (not scope creep):
- `src/lib/movers.ts` — export-only (`EPSILON`, `key`, `contribution`); no behavior change.
- `src/components/assets/NetWorthDisplay.dom.test.tsx` — fixture gains `show_on_chart: false` to satisfy the non-optional Row type.

## Findings

### F1 — Line colors are position-keyed, not identity-keyed

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/AssetTrendsChart.tsx:230 (`assetColor(i, lines.length)`)
- **Detail**: Hue derives from the asset's index in the opted-in `lines` array; toggling an asset off shifts later lines' colors. Legend/tooltip stay consistent within a render. Plan only required "color-distinct," which holds.
- **Fix**: If stability matters later, key the hue off a stable hash of `key(name, category_id)` instead of the array index.
- **Decision**: SKIPPED

### F2 — All-history snapshot_items query is unbounded

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/pages/dashboard.astro:47-51
- **Detail**: Loads every snapshot_item across every snapshot per dashboard load (one round trip, scoped by parent user_id, RLS-safe — no N+1). Explicitly acknowledged in the plan's "Performance Considerations"; a documented decision, not drift.
- **Fix**: None now. If history grows, filter server-side to the opted-in (name, category_id) set or cap the snapshot window.
- **Decision**: SKIPPED

### F3 — Row-shaping is O(snapshots² × lines) via per-cell find()

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/components/AssetTrendsChart.tsx:140
- **Detail**: `series.points.find(p => p.date === s.created_at)` per asset per snapshot. Negligible at tens of snapshots; consistent with NetWorthChart's un-memoized derivation.
- **Fix**: If snapshot counts grow, pre-build a `Map<date, TrendPoint>` per series.
- **Decision**: SKIPPED

### F4 — Misleading rate-direction comment in test

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/asset-trends.test.ts:11-12
- **Detail**: Comment said "1 EUR = 0.5 USD" while RATES makes EUR the weaker currency (rates are USD-denominated divisors). Assertions were already correct; only the prose inverted the convention.
- **Fix**: Reworded the comment to state rates are USD-denominated divisors (EUR = 2.0 ⇒ amt / 2; 200 EUR → 100 USD).
- **Decision**: FIXED

### F5 — Dashboard query omits planned `display_currency` column

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dashboard.astro:49
- **Detail**: Plan's select string listed `display_currency`; implementation selects `"id, created_at, snapshot_items(...)"`. Benign narrowing — nothing consumes per-snapshot display currency in the trends path (the island uses the page-level `displayCurrency`).
- **Fix**: None needed; optionally note the narrowing in the plan.
- **Decision**: SKIPPED
