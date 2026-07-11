<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Dashboard — Net Worth, Deltas, and Trend Chart

- **Plan**: context/changes/dashboard-snapshots-chart/plan.md
- **Scope**: All phases (1, 2, 3 of 3)
- **Date**: 2026-05-31
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 5 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING ⚠️ |
| Success Criteria | WARNING ⚠️ |

## Findings

### F1 — Snapshot items insert can orphan a snapshot row on partial failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/snapshots/index.ts:114-154
- **Detail**: The POST handler inserts a `snapshots` row, then inserts `snapshot_items` rows in a separate operation. If the items insert fails, the snapshot row is already committed — no transaction wrapping both, no rollback, no compensating delete.
- **Decision**: ACCEPTED-AS-RULE: DB multi-table writes must be atomic + FIXED: compensating delete added at snapshots/index.ts:151

### F2 — Inline arrow callbacks defeat useCallback stability in NetWorthDisplay

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:53-55, 61-63
- **Detail**: Inline arrow callbacks in Astro template create new references on each render, defeating useCallback stability. The immediate window.location.reload() masks correctness issues.
- **Decision**: SKIPPED

### F3 — Inconsistent unauthenticated error messages in snapshot API

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/snapshots/index.ts:14, 22, 51, 58
- **Detail**: The snapshots endpoint uses three different messages ("Not configured", "Unauthorized") across four auth guards instead of the consistent "Not authenticated" used elsewhere.
- **Decision**: FIXED: All four auth messages replaced with "Not authenticated"

### F4 — Unused `getRates` call in snapshot POST handler

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/snapshots/index.ts:86
- **Detail**: `getRates` was misidentified as unused — `rates` is passed as the 4th argument to `convertAmount` and used via closure. This was a false positive.
- **Decision**: DISMISSED (false positive)

### F5 — Pre-existing lint crash (unrelated to this change)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/dashboard/assets/index.astro:16
- **Detail**: ESLint crashed with a TypeScript-ESLint assertion error on Astro files. Root cause: `typescript-eslint` 8.x / `astro-eslint-parser` compatibility gap. Upgrading to 8.60.0 and disabling `no-misused-promises` for Astro files resolved it.
- **Decision**: FIXED: Upgraded typescript-eslint to 8.60.0; added `"@typescript-eslint/no-misused-promises": "off"` in astroConfig in eslint.config.js

### F6 — Dead `fetchError` state in NetWorthChart

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/NetWorthChart.tsx:61, 98-100
- **Detail**: `const [fetchError, setFetchError] = useState<string | null>(null);` — setFetchError is never called; fetchError always renders as null.
- **Decision**: SKIPPED

### F7 — Unauthenticated `GET /api/rates` inconsistent with project auth pattern

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/rates.ts
- **Detail**: `rates.ts` does not call `supabase.auth.getUser()` — unlike every other API route. Rates are intentionally unauthenticated public financial data.
- **Decision**: ACCEPTED-AS-RULE: Public API endpoints need explicit auth decisions + FIXED: Added comment documenting intentional public design
