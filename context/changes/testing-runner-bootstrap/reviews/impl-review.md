<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: testing-runner-bootstrap

- **Plan**: context/changes/testing-runner-bootstrap/plan.md
- **Scope**: full plan (2 phases + epilogue)
- **Date**: 2026-06-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — `supabase-browser.ts` is dead code with a server/client env-var boundary bug

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/supabase-browser.ts:1-13
- **Detail**: Imports `SUPABASE_URL` / `SUPABASE_KEY` from `astro:env/server` (a server-only context) into a module named `supabase-browser.ts` whose only export is `getSupabaseBrowserClient()`. At runtime, the server env context is never injected into the browser bundle, so the function always sees `null`/`undefined` and silently returns nothing for every caller. The Phase 2 tsc fix tightened the schema generic to `createBrowserClient<Database, "public">` — that fix is correct in isolation but does not address the env-var boundary mismatch. There are currently zero callers in the repo (grep confirms), so nothing breaks today, but the file is a footgun: any future import silently fails.
- **Fix**: Delete the file (no callers, latent bug, tsc-clean but runtime-broken).
  - Strength: Removes dead code; eliminates the footgun; one-line delete.
  - Tradeoff: None for current code. If a future route needs a browser client, a fresh module should be written with `astro:env/client` imports (or the public anon key from a `PUBLIC_*` env var).
  - Confidence: HIGH — grep proves zero callers.
  - Blind spot: None significant.
- **Decision**: PENDING

### F2 — Vitest version drift between plan.md (`^3.2.0`) and lockfile (`^3.2.6`)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/testing-runner-bootstrap/plan.md:153
- **Detail**: Plan specified `"vitest": "^3.2.0"`; `npm install vitest@^3.2.0` resolved to the latest 3.2.x = `3.2.6` at install time and locked to `^3.2.6`. The test-plan.md §4 stack table was updated to `^3.2.6` to match, so the spec and the test plan agree, but plan.md still says `^3.2.0`. No behavioural impact (semver-compatible patch). Doc inconsistency only.
- **Fix**: Amend plan.md to `^3.2.6` (or accept `^3.2.0` in a follow-up pinning).
  - Strength: Doc consistency with the locked install.
  - Tradeoff: None — both ranges are semver-compatible.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: PENDING

### F3 — `as Currency` casts proliferate at 7 call sites (documented compromise)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/assets/NetWorthDisplay.tsx:141, 204, 215; src/components/assets/AssetRow.tsx:16; src/components/assets/AssetsSummary.tsx:22, 30; src/pages/api/snapshots/index.ts:89, 100, 147, 149
- **Detail**: Supabase's `Tables<'assets'>['currency']` is typed as `string` (the SQL column is `text`), so every call site that passes `asset.currency` to the now-typed `convertAmount(amount, fromCurrency: Currency, ...)` must cast. There are 7 `as Currency` casts across 4 files. The plan §Critical Implementation Details acknowledged this as a deliberate trade-off: broadening `convertAmount` to accept `string` and validating internally would push unsafe narrowing into the helper. The current shape is type-honest at the boundary and unsafe at the call site.
- **Fix**: Document the convention in a code comment on `convertAmount` and add a short note to `context/foundation/lessons.md` flagging the pattern.
  - Strength: Makes the trade-off discoverable for future maintainers; no behavioural change.
  - Tradeoff: Minor — one comment + one lessons.md entry.
  - Confidence: MEDIUM — depends on whether future maintainers read lessons.md.
  - Blind spot: Not all 7 casts are visible from one entry point; future renames of the cast target could leave stale comments.
- **Decision**: PENDING

### F4 — `AssetRow.tsx:31` redefines the `Currency` literal union inline

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/assets/AssetRow.tsx:31
- **Detail**: The file imports `type Currency` from `@/lib/net-worth` (line 4) and uses it on line 16, but line 31 hardcodes the literal union: `asset.currency as "USD" | "EUR" | "PLN"`. This is the third copy of the same definition (after the local redeclaration that was just removed from `NetWorthDisplay.tsx`, and the canonical one in `exchange-rates.ts`). Replace with `as Currency` to keep a single source of truth.
- **Fix**: Change line 31 from `as "USD" | "EUR" | "PLN"` to `as Currency`.
- **Decision**: PENDING

### F5 — `vitest.config.ts` does not actually verify the `@/*` path alias works

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: vitest.config.ts:1-8; src/lib/net-worth.test.ts:2-3
- **Detail**: The plan claims Vite 7 auto-resolves tsconfig paths; in fact Vite 7 does NOT do this by default and the community uses `vite-tsconfig-paths` for it. The single test file uses a relative import (`./net-worth`), not the `@/*` alias, so the alias resolution is unverified end-to-end. The next test that imports across directories (e.g. a `src/components/` test) will surface this. Risk is contained by the §6.1 cookbook's co-location rule, but a future cross-directory test will hit it.
- **Fix**: Add `vite-tsconfig-paths` to devDependencies and include it in vitest.config.ts. Or document the limitation in the §6.1 cookbook entry.
- **Decision**: PENDING

### F6 — `net-worth.test.ts` uses relative import instead of the project `@/*` alias

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/net-worth.test.ts:2-3
- **Detail**: `import { computeNetWorth } from "./net-worth"` rather than `import { computeNetWorth } from "@/lib/net-worth"`. All 4 production call sites use the alias. Minor inconsistency.
- **Fix**: Switch to `@/lib/net-worth` (and verify the alias works — see F5).
- **Decision**: PENDING

### F7 — Phase 2 tsc fixes are bundled with the test bootstrap commit

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: commit 405bac5 (9 files)
- **Detail**: The Phase 2 commit bundles 3 unrelated tsc fixes (supabase-browser.ts, NetWorthDisplay.tsx null guards, snapshots/index.ts null guard) with the test bootstrap work. Each fix is individually correct and the commit message documents the bundle, so this is acceptable, but it makes bisection harder later. A split into `chore: fix pre-existing tsc errors` + `feat: vitest + first unit test` would be cleaner.
- **Fix**: Leave as-is (already committed; the bundle is documented).
- **Decision**: PENDING

### F8 — `NetWorthDisplay.tsx` IIFE duplicates `computeNetWorth`'s loop

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/components/assets/NetWorthDisplay.tsx:137-149, 199-202, 210-213
- **Detail**: The IIFE at 137-149 re-implements the same `totalAssets - totalLiabilities` loop that `computeNetWorth` already encapsulates, just to expose `totalAssets` and `totalLiabilities` separately. The two `.filter().reduce()` calls at 199-202 and 210-213 separately compute the same totals a third and fourth time. This is the exact duplication the extraction was meant to eliminate. Out of scope for Phase 1 (the plan explicitly scoped the refactor to "drop the local `convertAmount` helper"), but a future refactor should have `computeNetWorth` return `{ totalAssets, totalLiabilities, netWorth }`.
- **Fix**: Out of scope for this change. Add a note to the `net-worth.ts` JSDoc.
- **Decision**: PENDING

### F9 — Risk #1 protection ceiling (DOM integration test) is deferred, not lost

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/test-plan.md:64
- **Detail**: Phase 1 delivered the unit test floor on `computeNetWorth`; the §2 row #1 risk response guidance also calls for a "small integration test on the dashboard render of the total," which is deferred (no DOM tooling in Phase 1). The deferral is captured in test-plan.md line 64 and §3 row 1 status is `complete`. Future `/10x-test-plan --refresh` invocations must preserve the deferral note.
- **Fix**: No code change. Note for the next test-plan refresh.
- **Decision**: PENDING

## Plan-Drift Sub-Agent Notes

8 of 8 changes in the plan match the implementation. 1 minor doc drift: `vitest` devDep locked at `^3.2.6` vs plan's `^3.2.0` (test-plan.md §4 was updated to `^3.2.6`; only plan.md remains inconsistent — see F2). No MISSING items, no EXTRA items beyond the declared scope-expansion tsc fixes.
