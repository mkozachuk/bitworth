# Testing Runner Bootstrap — Plan Brief

> Full plan: `context/changes/testing-runner-bootstrap/plan.md`
> Research: `context/changes/testing-runner-bootstrap/research.md`
> Test plan: `context/foundation/test-plan.md` §3 row "Runner bootstrap + first critical-path unit"

## What & Why

Phase 1 of `test-plan.md`: bootstrap the Vitest runner and ship the first unit test on the net worth calculation (Risk #1). The test target does not yet exist as a standalone function — the formula is duplicated 4× across components and the snapshots API — so this phase bundles the extraction with the test bootstrap. The two are inseparable: the refactor is what makes the test possible, and the test is what pins the refactor against regression.

## Starting Point

No test runner installed. `convertAmount` lives inline in four files with the per-call-site `Currency` type redefined locally in at least one of them. `NetWorthDisplay.tsx:148-160` computes the net worth total via an IIFE; `src/pages/api/snapshots/index.ts:98-119` re-derives the same total server-side; both can drift independently. The dashboard's formatted total only appears after React hydration (no server-rendered total to test against). The legacy `@astrojs/test` package is gone in Astro v6.

## Desired End State

After this change:

- `npm run test:run` exits 0 and reports 3 passing tests pinning the net worth calculation.
- The formula exists in exactly one place: `src/lib/net-worth.ts`, exporting `convertAmount` and `computeNetWorth` with `Currency`-typed signatures.
- All four former call sites import from the new module; no visible behaviour change in the running app.
- A regression in mixed-currency conversion, liability-sign handling, or cent-scaling fails the test suite.
- `test-plan.md` §3 row carries a deferral note for the DOM integration test; §6 cookbook is filled in.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Test runner | Vitest 3.x | Vite 7 + Astro 6 + ESM-native, zero transform pipeline, one devDep | Research |
| Module location | `src/lib/net-worth.ts` | Single file; matches existing `src/lib/` flat layout | Plan |
| Refactor scope | All 4 call sites in Phase 1 | Eliminates the duplication the risk response guidance warned about | Plan |
| Commit strategy | Two commits: refactor, then test | Refactor is provably behaviour-preserving before the test pins it | Plan |
| DOM integration test | Deferred to follow-up phase | No jsdom / testing-library installed; installing them is scope creep | Plan |
| Type signature | `fromCurrency: Currency` (tightened from `string`) | Eliminates the unsafe `as Currency` cast at `NetWorthDisplay.tsx:24`; type system enforces currency validity | Plan |
| Test count | 3 cases (exact oracle, FP probe, liability sign) | Covers all 4 risks in `test-plan.md` §2 row #1; skips NaN guard (separate concern) | Plan |
| Test fixture style | Hand-built inline literals | Three tests don't need a factory; defer to Phase 2 | Research |
| Test framework API | Explicit `import { describe, it, expect } from "vitest"` | Avoids `globals: true` shortcut that would require `"types": ["vitest/globals"]` | Research |
| What to extract | `convertAmount` + `computeNetWorth` (two functions) | `convertAmount` is the primitive; `computeNetWorth` is the aggregate the test pins | Research |
| test-plan.md update | Update §3 row (deferral note) + fill in §6.1 / §6.5 cookbook | Make the deferral visible; close the cookbook placeholders | Plan |

## Scope

**In scope:**
- Create `src/lib/net-worth.ts` with `convertAmount` and `computeNetWorth` (both `Currency`-typed).
- Rewire 4 call sites: `NetWorthDisplay.tsx`, `AssetsSummary.tsx`, `AssetRow.tsx`, `src/pages/api/snapshots/index.ts`.
- Drop the locally-redeclared `Currency` type in `NetWorthDisplay.tsx`; import from `src/lib/exchange-rates.ts`.
- Add `vitest` to devDependencies; add `vitest.config.ts` at the repo root.
- Add `test` and `test:run` scripts to `package.json`.
- Write `src/lib/net-worth.test.ts` with 3 test cases (exact oracle, FP probe, liability sign).
- Update `test-plan.md` §3 row (deferral note) and §6.1 / §6.5 cookbook entries.

**Out of scope:**
- DOM integration test on the dashboard render — deferred until a follow-up phase installs `@testing-library/react` + `jsdom` or `happy-dom`.
- CI wiring (Phase 4 of `test-plan.md`).
- MSW, Playwright, coverage tooling, vitest UI.
- Adding a missing-currency-key guard to `computeNetWorth` (preserves current behaviour; the inconsistency in `AssetsSummary.tsx:34` is a separate concern).
- Asserting crypto valuation (`assets.quantity` is a display label; the net worth path does not call `getPrice`).
- Editing `src/lib/utils.ts` (it contains only `cn()`; not the target).

## Architecture / Approach

```
src/lib/net-worth.ts (NEW)
  ├── convertAmount(amount, fromCurrency, toCurrency, rates) → number
  └── computeNetWorth(assets, displayCurrency, rates) → number
        ↑                                    ↑
        │ uses                               │ uses
        │                                    │
NetWorthDisplay.tsx (IIFE + 2 .reduce calls)
AssetsSummary.tsx     (per-currency loop; behaviour unchanged)
AssetRow.tsx          (single-asset conversion)
src/pages/api/snapshots/index.ts (IIFE + per-item loop)
```

```
src/lib/net-worth.test.ts (NEW)
  describe('computeNetWorth', () => {
    it('returns 1700 USD for the standard mixed-currency + liability fixture')
    it('handles non-round input via toBeCloseTo')
    it('treats a positive liability as strictly subtracting from the total')
  })
```

Two commits, two phases:

1. **Refactor** — extract + rewire. No test added. Behaviour-preserving.
2. **Test** — install runner + add the test + update `test-plan.md`. Pins the post-refactor state.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Refactor — extract + rewire | `src/lib/net-worth.ts`; 4 call sites import from it; `fromCurrency` tightened to `Currency` | Type tightening surfaces any non-`Currency` caller; implementer must fix before the test can land |
| 2. Test runner + first unit test | `vitest` devDep; config + scripts; 3-test suite; `test-plan.md` §3 deferral + §6 cookbook filled in | Mutation-test discipline: each test must demonstrably fail when its target code path is broken |

**Prerequisites:** Phase 1 of `test-plan.md` is the natural first target (Risk #1, High × High). No prior test infrastructure to remove. The four call sites must be rewireable (verified by reading their `.ts` and `.tsx` files — they all consume `convertAmount` with structurally-compatible inputs).

**Estimated effort:** ~2 focused sessions. Phase 1 is a small refactor with type tightening (~5 file edits). Phase 2 is infrastructure + a small test file + a `test-plan.md` edit.

## Open Risks & Assumptions

- **Assumption:** All four call sites pass `Currency`-typed values to `convertAmount`. Verified for `NetWorthDisplay.tsx:152` (`asset.currency` is `Tables<'assets'>['currency']` = `Currency`); the others follow the same pattern. The type tightening is a self-checking assumption — if it fails compilation, the implementer sees the error.
- **Risk:** The clean-oracle test (`toBe(1700)`) is exact-equality against `500 / 1.0 * 1` and `2000 / 4.0 * 1`, which are both exact in IEEE 754. If a future maintainer changes the formula to introduce an intermediate computation that loses precision, the test fails — which is the intended signal.
- **Risk:** The deferral note in `test-plan.md` §3 may be skipped by a future refresh. The plan marks the DOM integration test as **deferred**, not removed. Future test-plan refreshes must respect the deferral.
- **Assumption:** Vite 7 + Vitest 3 first-party compatibility is stable. Confirmed via Context7 `/vitest-dev/vitest`. If a Vitest 3.x patch breaks `@/*` path resolution, the fix is one line (`vite-tsconfig-paths`).

## Success Criteria (Summary)

- The 3 test cases pass deterministically (`npm run test:run` exits 0).
- The dashboard total, the snapshot's `total_net_worth`, and the per-side subtotals are byte-identical to pre-refactor values for the same inputs.
- Each test demonstrably fails when its target code path is broken (mutation-test discipline).
- `test-plan.md` §3 row and §6 cookbook accurately reflect what Phase 1 shipped.
