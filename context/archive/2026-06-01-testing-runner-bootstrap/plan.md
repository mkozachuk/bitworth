# Testing Runner Bootstrap — Implementation Plan

## Overview

Phase 1 of `context/foundation/test-plan.md`: bootstrap the Vitest runner and ship the first unit test on the net worth calculation (Risk #1). The test target does not yet exist as a standalone function — the formula is duplicated across four files — so Phase 1 bundles the extraction with the test bootstrap. The two are inseparable: the refactor is what makes the test possible, and the test is what pins the extraction.

## Current State Analysis

**No test runner installed.** `package.json` has no `test` script; no `vitest.config.*`; no test files. `devDependencies` has no runner. The legacy `@astrojs/test` / `@astrojs/test-utils` packages are gone in Astro v6 (confirmed via Context7 `/vitest-dev/vitest`).

**The net worth formula is duplicated 4× and is not a standalone function.** It lives inline as a module-local `convertAmount` helper in `NetWorthDisplay.tsx:17-26`, `AssetsSummary.tsx:13-22`, and `AssetRow.tsx:15-27`, and as a function declaration in `src/pages/api/snapshots/index.ts:98-119`. The display IIFE in `NetWorthDisplay.tsx:148-160` and the per-side subtotals at lines 210-215 and 222-225 all consume the same logic. There is no `src/lib/net-worth.*` file.

**The four call sites are slightly inconsistent.** `NetWorthDisplay.tsx` computes totalAssets − totalLiabilities and renders the breakdown. `AssetsSummary.tsx:32-38` per-currency loop does NOT split liabilities (it sums all rows by currency) AND guards `!(currency in byCurrency) continue;` (line 34); the other three sites do not have that guard, so a foreign-currency asset with an unrecognised code would silently produce a `NaN` total at those sites. `src/pages/api/snapshots/index.ts:98-119` re-derives the same total server-side and persists it. The refactor extracts the shared logic; it does NOT yet fix the per-currency loop inconsistency (separate concern, see Open Risks).

**The "small integration test" in `test-plan.md` §2 row #1 cannot target a server-rendered DOM.** `src/pages/dashboard.astro:20-31` fetches data in the frontmatter but does not compute the total; it hands raw `assets`, `rates`, `displayCurrency` to a `client:load` React island. The formatted dollar figure only appears after React hydrates. No DOM testing library, no jsdom, no happy-dom is installed. The integration test must be deferred to a follow-up phase that installs DOM tooling.

**Currency type is redefined locally.** `NetWorthDisplay.tsx:7` redeclares `Currency` as a literal union instead of importing the canonical one from `src/lib/exchange-rates.ts:3`. The extraction is the right place to consolidate.

**The vitest install is minimal and well-bounded.** One devDep (`vitest`), one config file, two scripts. Vite 7 (overridden in `package.json:60`) auto-resolves the `@/*` paths declared in `tsconfig.json:10-11`, so no `vite-tsconfig-paths` is needed. No DOM, no MSW, no @testing-library.

## Desired End State

After this change lands:

- `npm run test:run` exits 0 and reports 3 passing tests.
- `npm run test` enters Vitest watch mode and re-runs on file change.
- The net worth formula exists in exactly one place: `src/lib/net-worth.ts`, exporting `convertAmount` and `computeNetWorth`.
- All four former call sites import from the new module. No behavioural change in the running app — the dashboard still renders the same total; `POST /api/snapshots` still persists the same value.
- A regression in mixed-currency conversion, liability-sign handling, or cent-scaling fails the test suite.
- `context/foundation/test-plan.md` §3 row for Phase 1 carries a deferral note for the DOM integration test; §6.5 cookbook is filled in with location, naming, reference test, and run command.

### Key Discoveries:

- The test target does not exist yet — the formula is duplicated at `src/components/assets/NetWorthDisplay.tsx:17-26` (helper) + `:148-160` (IIFE), `src/components/assets/AssetsSummary.tsx:13-22` and `:32-38`, `src/components/assets/AssetRow.tsx:15-27`, and `src/pages/api/snapshots/index.ts:98-119`. Extraction is prerequisite, not optional.
- `NetWorthDisplay.tsx:7` redefines `Currency` locally; the canonical type is `src/lib/exchange-rates.ts:3`. The extraction imports the canonical type and the four call sites follow.
- `NetWorthDisplay.tsx:19` accepts `fromCurrency: string` and uses an unsafe `as Currency` cast at line 24. Tightening to `Currency` in the extracted module surfaces any caller passing a non-currency string; the four current call sites all pass `Tables<'assets'>['currency']` which is the right type, so the change is type-safe.
- `assets.amount` is stored as `NUMERIC(18, 2)` (per `supabase/migrations/20260529190856_initial_schema.sql:33`); no cent scaling, no ×100 / ÷100 anywhere in the source. The test fixture uses plain `number` inputs and includes a non-round `333.33`-class value to probe for any future cent-scaling bug.
- The dashboard total is computed client-side in `NetWorthDisplay.tsx:148-160` AND server-side in `src/pages/api/snapshots/index.ts:98-119`; the snapshot persists `total_net_worth` independently. Both paths now use the same module, so they cannot drift on the calculation.

## What We're NOT Doing

- **DOM integration test.** No jsdom, happy-dom, @testing-library/react in Phase 1. The "small integration test on the dashboard render of the total" from `test-plan.md` §2 row #1 is explicitly deferred to a follow-up phase.
- **CI wiring.** `test:run` is a local-only command in Phase 1. Phase 4 of `test-plan.md` owns the GitHub Actions integration.
- **MSW, Playwright, coverage tooling, vitest UI.** None are in scope for Phase 1.
- **Adding a missing-currency-key guard to `computeNetWorth`.** `AssetsSummary.tsx:34` has a `(currency in byCurrency)` guard; the other three sites do not. The extraction preserves current behaviour; the inconsistency is a separate concern.
- **Asserting crypto valuation.** `assets.quantity` is a display label per `AssetRow.tsx:44-51`; the net worth path does not call `getPrice` from `src/lib/crypto-prices.ts`. The test reflects the design (amount is already fiat) and the fixture comment explains why.
- **Editing `src/lib/utils.ts`.** It contains only `cn()`; not the target.

## Implementation Approach

Extract first, then test. Two commits, two phases:

- **Commit 1 (Phase 1)** — pure refactor. No test added; no behaviour change. The new module is unreferenced by tests but already used by all four call sites. The dashboard renders identically. CI is happy. The commit is provably behaviour-preserving.
- **Commit 2 (Phase 2)** — test infrastructure + first test + test-plan.md update. The extracted module now has a pin against regression. If a future maintainer changes the formula, the test fails.

The order matters: the refactor must land first because (a) the test cannot exist without a target, and (b) if the test were added against a copy of the formula, the implementation could still drift after extraction. Land the refactor; the test pins the post-refactor state.

## Critical Implementation Details

- **`fromCurrency: string` in `NetWorthDisplay.tsx:19` is an unsafe cast, not an intentional permissiveness.** The four call sites all pass `Tables<'assets'>['currency']` (which is `'PLN' | 'USD' | 'EUR'` = `Currency`). Tightening to `Currency` in the extracted function will compile because all four sites are type-correct. If a future site passes a non-currency string (e.g. a crypto symbol), the compiler will catch it. The refactor IS the type tightening.
- **The AssetsSummary per-currency loop is silently different from the others.** It sums all rows by currency without splitting liabilities, AND it guards `!(currency in byCurrency) continue;`. After extraction, `AssetsSummary.tsx` will import `convertAmount` but keep its own loop logic. The refactor does not change the per-currency loop. The test pins `computeNetWorth` (the aggregate), not the per-currency breakdown. A future phase that adds a per-currency test will need to reconcile the inconsistency separately.

## Phase 1: Refactor — extract + rewire (commit 1)

### Overview

Create `src/lib/net-worth.ts` with two pure functions (`convertAmount` and `computeNetWorth`), then rewire the four call sites to import from it. No test added in this commit. The refactor is purely additive: same values rendered, same values persisted, same types throughout.

### Changes Required:

#### 1. New module: `src/lib/net-worth.ts`

**File**: `src/lib/net-worth.ts` (NEW)

**Intent**: Hold the two pure functions that the net worth calculation depends on, in one place, with the canonical `Currency` type from `src/lib/exchange-rates.ts`. The module is the single source of truth for currency conversion and aggregate total computation.

**Contract**:
- Exports `convertAmount(amount: number, fromCurrency: Currency, toCurrency: Currency, rates: Record<Currency, number>): number`. Same-currency short-circuit (`fromCurrency === toCurrency` returns `amount`); otherwise `amount / rates[fromCurrency] * rates[toCurrency]`.
- Exports `computeNetWorth(assets: NetWorthAsset[], displayCurrency: Currency, rates: Record<Currency, number>): number`. Returns `totalAssets - totalLiabilities`; each row's `amount` is converted via `convertAmount` and routed to one of the two buckets based on `category.is_liability`.
- `Currency` is imported from `./exchange-rates`. The locally-redeclared type at `NetWorthDisplay.tsx:7` is removed in step 2.
- `NetWorthAsset` is a minimal structural type: `{ amount: number; currency: Currency; category: { is_liability: boolean } }`. Compatible with `Tables<'assets'> & { category: Tables<'asset_categories'> }` from `@/lib/database.types` because the row is a superset.

#### 2. Rewire `src/components/assets/NetWorthDisplay.tsx`

**File**: `src/components/assets/NetWorthDisplay.tsx`

**Intent**: Drop the local `convertAmount` helper and the locally-redeclared `Currency` type; import both from the new module. The three consumption sites (IIFE at lines 148-160, per-side subtotals at lines 210-215 and 222-225) call the new `convertAmount` identically.

**Contract**: No visible behaviour change. The IIFE, the asset subtotal `.filter().reduce()`, and the liability subtotal `.filter().reduce()` all import the new helper. The local `function convertAmount(...)` declaration (lines 17-26) is removed. The local `type Currency = "USD" | "EUR" | "PLN"` at line 7 is removed in favour of the imported type from `@/lib/exchange-rates`. The `AssetWithCategory` type at line 5 stays as-is (it is the DB join shape, not a currency thing).

#### 3. Rewire `src/components/assets/AssetsSummary.tsx`

**File**: `src/components/assets/AssetsSummary.tsx`

**Intent**: Drop the locally-redeclared `convertAmount` helper; import from the new module. The per-currency loop at lines 32-38 (which does NOT split liabilities and has the `(currency in byCurrency)` guard) is left structurally intact.

**Contract**: No visible behaviour change. The per-currency loop still sums all rows by currency and still has the guard. The helper used inside `.reduce()` is now imported.

#### 4. Rewire `src/components/assets/AssetRow.tsx`

**File**: `src/components/assets/AssetRow.tsx`

**Intent**: Drop the locally-redeclared `convertAmount` helper; import from the new module. The single-asset conversion call site stays structurally intact.

**Contract**: No visible behaviour change. The single-asset row display still converts via the same formula.

#### 5. Rewire `src/pages/api/snapshots/index.ts`

**File**: `src/pages/api/snapshots/index.ts`

**Intent**: Drop the function-declared `convertAmount` (lines 98-119) and any subsequent local helper; import from the new module. The two consumption sites (the IIFE that writes `totalNetWorth` to the new `snapshots` row, and the per-snapshot-item loop at line 150 that writes `converted_amount`) both call the new `convertAmount`.

**Contract**: No visible behaviour change. The persisted `total_net_worth` and per-item `converted_amount` are byte-identical to pre-refactor values for the same inputs.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles cleanly: `npx tsc --noEmit` exits 0
- ESLint passes: `npm run lint` exits 0
- Astro build succeeds: `npm run build` exits 0
- The four call sites contain no local declarations of `convertAmount` (grep `function convertAmount` across `src/components/` and `src/pages/api/snapshots/index.ts` returns only the definition in `src/lib/net-worth.ts`)
- The new module is referenced by all four call sites (grep `from "@/lib/net-worth"` returns 4 hits)

#### Manual Verification:

- `npm run dev` starts the dashboard; the net worth total renders the same value as before the refactor (visually compare to a known fixture, e.g. the values from the running app today)
- `POST /api/snapshots` (via the "Save Snapshot" button on the dashboard) creates a new `snapshots` row whose `total_net_worth` matches the displayed total to the cent
- The per-side subtotals (Assets / Liabilities) on the dashboard still sum correctly to the displayed total
- The chart in `NetWorthChart.tsx` (which reads `total_net_worth` directly from the DB) still plots the new snapshot

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the running app behaves identically before proceeding to Phase 2. The refactor must be provably behaviour-preserving before the test pins it.

---

## Phase 2: Test runner + first unit test (commit 2)

### Overview

Install Vitest, write the first unit test against the extracted `computeNetWorth` function, and update `test-plan.md` so the cookbook and the §3 row reflect what Phase 1 actually shipped. The test pins the post-refactor behaviour with an independent oracle (a value derived from first principles, not by reading the implementation).

### Changes Required:

#### 1. Install Vitest and add the runner config

**File**: `package.json`

**Intent**: Add `vitest` as a devDependency and the two run scripts (`test` for watch mode, `test:run` for one-shot CI use).

**Contract**: The `scripts` block gains two entries: `"test": "vitest"` and `"test:run": "vitest run"`. The `devDependencies` block gains `"vitest": "^3.2.6"`. No changes to `dependencies` or to the existing scripts.

**File**: `vitest.config.ts` (NEW at repo root)

**Intent**: Configure Vitest to discover tests in `src/**/*.test.ts` and run in `node` environment (no DOM needed for the first test).

**Contract**: The config uses `defineConfig` from `vitest/config` and sets `test.include: ["src/**/*.test.ts"]` and `test.environment: "node"`. No `mergeConfig` with `astro.config.mjs` — Tailwind, React, and the Cloudflare adapter are irrelevant to a pure-TS calculation. Vite 7 (the override in `package.json:60`) auto-resolves the `@/*` paths declared in `tsconfig.json:10-11`, so no `vite-tsconfig-paths` is needed.

#### 2. Write the first unit test

**File**: `src/lib/net-worth.test.ts` (NEW)

**Intent**: Pin the net worth calculation against an independent oracle. The test exercises the three failure modes named in `test-plan.md` §2 row #1: mixed-currency conversion, liability-sign handling, and floating-point drift (with non-round inputs as a cent-scaling probe).

**Contract**: A `describe('computeNetWorth', ...)` block with three `it(...)` cases:

- **Clean-oracle exact.** Rates `{ USD: 1, EUR: 1.0, PLN: 4.0 }`, display currency `USD`. Inputs: `1000 USD` asset, `500 EUR` asset, `2000 PLN` asset, `300 USD` liability. Expected: `1000 + 500 + 500 − 300 = 1700` exactly. Asserts `toBe(1700)` (no tolerance). Exercises the same-currency short-circuit (1000 USD), the conversion branch with a foreign source (500 EUR → 500 USD), and the conversion branch with a third currency (2000 PLN / 4.0 → 500 USD).
- **Floating-point probe.** Rates `{ USD: 1, EUR: 1.1, PLN: 0.25 }`, display currency `USD`. Same inputs as above. Expected: `1000 + (500/1.1) + (2000/0.25) − 300 ≈ 9154.5454...`. Asserts `toBeCloseTo(9154.545454545454, 6)`. Exercises the same shape with non-round division (500/1.1 is recurring); also serves as a cent-scaling probe — if a future maintainer introduces ×100 / ÷100, this test fails.
- **Liability-sign guard.** Rates `{ USD: 1, EUR: 1.0, PLN: 1.0 }`, display currency `USD`. Two fixtures with the same single `500 USD` row, differing only in `category.is_liability`. Asserts the asset version returns `500`, the liability version returns `−500`, and the asset total is strictly greater than the liability total. Exercises the sign convention — a positive liability amount must produce a strictly lower total than the same input as an asset.

The test imports `computeNetWorth` from `./net-worth` and uses explicit `import { describe, it, expect } from "vitest"` (no `globals: true`, to keep the strict `astro/tsconfigs/strict` base working). The fixture uses inline literal objects (no factory, per the research open question #4 recommendation).

#### 3. Update `context/foundation/test-plan.md`

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect what Phase 1 actually shipped. The §3 row for Phase 1 gains a deferral note; the §6.5 cookbook entry is filled in with the location, naming convention, reference test path, and run command.

**Contract**:
- §3 row "Runner bootstrap + first critical-path unit" gains a sub-bullet under "Status" or a deferred-until-follow-up note pointing to the DOM-integration test from `test-plan.md` §2 row #1 risk response guidance.
- §6.5 "Adding a test for the net worth calculation / currency conversion" is filled in:
  - **Location**: `src/lib/net-worth.test.ts` (co-located with the module under test)
  - **Naming**: `<module>.test.ts` next to `<module>.ts` in `src/lib/`
  - **Reference test**: `src/lib/net-worth.test.ts` — `describe('computeNetWorth', ...)` with the three cases
  - **Run locally**: `npm run test:run` (one-shot) or `npm run test` (watch)
- The §6.1 "Adding a unit test" cookbook entry is also filled in with the same location / naming / reference test / run command (the §6.5 entry is the specific case; §6.1 is the general pattern).

### Success Criteria:

#### Automated Verification:

- Vitest install is in place: `npx vitest --version` exits 0
- One-shot test run: `npm run test:run` exits 0 and reports 3 passing tests
- Test discovery picks up the new file: `npm run test:run -- --reporter=verbose` lists the `describe` block and all 3 `it` cases by name
- TypeScript still compiles: `npx tsc --noEmit` exits 0
- ESLint still passes: `npm run lint` exits 0
- Astro build still succeeds: `npm run build` exits 0
- `test-plan.md` §3 row carries the deferral note; §6.1 and §6.5 cookbook entries are filled in (no `TBD — see §3 Phase <N>` text remains for Phase 1 sub-sections)
- `package.json` has `vitest` in `devDependencies` and the two scripts in the `scripts` block

#### Manual Verification:

- `npm run test` enters Vitest watch mode and re-runs on file save
- Temporarily change `computeNetWorth` to `return totalAssets + totalLiabilities` (positive instead of negative); confirm the test fails with a clear diff between expected and actual; revert
- Temporarily swap `category.is_liability` for `!category.is_liability` in `computeNetWorth`; confirm the liability-sign guard test fails; revert
- The clean-oracle test (`toBe(1700)`) fails on any non-exact answer — verify by temporarily adding `+ 0.0000001` inside `convertAmount` and confirming the test fails
- `grep -r "from '@/lib/net-worth'" src/components src/pages/api/snapshots` returns 4 hits (proves the refactor stuck and the test is exercising the real module)
- `test-plan.md` §3 row reads correctly in rendered form; §6.1 and §6.5 are no longer placeholders

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human. The three failure-mode probes (exact oracle, FP drift, liability sign) are the heart of Risk #1's protection — they must each demonstrably fail when the corresponding code path is broken.

---

## Testing Strategy

### Unit Tests (this phase):

- `src/lib/net-worth.test.ts` — three cases on `computeNetWorth`:
  1. **Clean-oracle exact** — mixed-currency conversion (same-currency short-circuit + two foreign currencies) with exact `toBe(1700)` against an independent hand-derived oracle.
  2. **Floating-point probe** — same fixture shape with non-round rates; `toBeCloseTo(9154.545454545454, 6)`. Also acts as a cent-scaling probe (fails if a future maintainer adds ×100 / ÷100).
  3. **Liability-sign guard** — single-row fixture in two configurations (asset vs liability); asserts the asset total is strictly greater than the liability total.

### Integration Tests (deferred):

- The "small integration test on the dashboard render of the total" from `test-plan.md` §2 row #1 is deferred to a follow-up phase that installs DOM tooling (`@testing-library/react` + `jsdom` or `happy-dom`). The §3 row for Phase 1 carries a deferral note. The plan does not pin a phase number for the follow-up — that decision is owned by the test-plan refresh that surfaces it.

### Manual Testing Steps:

1. `npm run dev` — start the Astro dev server, log in, verify the dashboard Net Worth total renders
2. Click "Save Snapshot" — confirm a new row appears in the chart and the persisted `total_net_worth` matches the displayed total
3. `npm run test:run` — confirm 3 tests pass with verbose output
4. `npm run test` — confirm watch mode re-runs on file save
5. Mutation-test: temporarily introduce a bug (e.g. flip the liability sign or add ×100), confirm the relevant test fails, revert

## Performance Considerations

None. The unit test runs in milliseconds. The refactor does not add runtime cost (function calls are inlined by Vite in production). The Vitest config is `node` environment, no JSX transform overhead, no DOM polyfill.

## Migration Notes

None for end users. The refactor is internal. The first test does not change any user-visible behaviour. `vitest` is a devDependency only.

## References

- Test plan: `context/foundation/test-plan.md` §1-§5 (strategy, risk map, phased rollout, stack, gates), §3 row "Runner bootstrap + first critical-path unit"
- Research: `context/changes/testing-runner-bootstrap/research.md`
- Refactor targets: `src/components/assets/NetWorthDisplay.tsx:17-26, 148-160`; `src/components/assets/AssetsSummary.tsx:13-22, 32-38`; `src/components/assets/AssetRow.tsx:15-27`; `src/pages/api/snapshots/index.ts:98-119`
- Type source: `src/lib/exchange-rates.ts:3`
- Schema constraints: `supabase/migrations/20260529190856_initial_schema.sql:18-39, 84-96`
- Stack grounding: Context7 `/vitest-dev/vitest` (Vitest docs, confirmed `@astrojs/test` is removed in Astro v6)

## Open Risks & Assumptions

- **Assumption: The four call sites pass `Currency`-typed values to `convertAmount`.** Verified by reading `NetWorthDisplay.tsx:152` (`asset.currency` is `Tables<'assets'>['currency']` = `Currency`). If any call site is passing a non-currency string, the type tightening in Phase 1 will fail compilation. The plan assumes this is not the case; the implementer will see any compile error immediately.
- **Risk: The clean-oracle test (`toBe(1700)`) is brittle to floating-point representation.** `500 / 1.0 * 1` is exact in IEEE 754; `2000 / 4.0 * 1` is exact. The test should pass deterministically. If a future maintainer changes the formula to introduce an intermediate computation that loses precision, the test fails — which is the intended signal.
- **Risk: The deferral note in `test-plan.md` §3 may be skipped by a future refresh.** The plan is explicit that the DOM integration test is deferred, not removed. If a future test-plan refresh re-derives the §3 row and drops the deferral, the integration test is silently lost. The plan assumes the test-plan refresh process respects the deferral note.
- **Assumption: Vite 7 + Vitest 3 first-party compatibility is stable.** Confirmed via Context7 `/vitest-dev/vitest`. If a Vitest 3.x patch release breaks the `@/*` path resolution, the test will fail to import; the fix is `vite-tsconfig-paths` (one-line config addition).
- **Risk: `NetWorthChart.tsx` reads `total_net_worth` from the DB snapshot, not from the live computation.** After this refactor, the live display and the persisted value both derive from the same `computeNetWorth` call. The chart's snapshot path is now consistent with the display only if the persistence path also uses the extracted function (it will, per Phase 1 step 5). This is an improvement, not a risk — but a reviewer should confirm the chart's data source hasn't drifted.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Refactor — extract + rewire (commit 1)

#### Automated

- [x] 1.1 TypeScript compiles cleanly: `npx tsc --noEmit` exits 0 — 4dbd505
- [x] 1.2 ESLint passes: `npm run lint` exits 0 — 4dbd505
- [x] 1.3 Astro build succeeds: `npm run build` exits 0 — 4dbd505
- [x] 1.4 The four call sites contain no local declarations of `convertAmount` (grep returns only `src/lib/net-worth.ts`) — 4dbd505
- [x] 1.5 The new module is referenced by all four call sites (grep returns 4 hits) — 4dbd505

#### Manual

- [x] 1.6 Dashboard Net Worth total renders the same value as before the refactor — 4dbd505
- [x] 1.7 `POST /api/snapshots` creates a new `snapshots` row whose `total_net_worth` matches the displayed total — 4dbd505
- [x] 1.8 Per-side subtotals (Assets / Liabilities) still sum correctly to the displayed total — 4dbd505
- [x] 1.9 Chart in `NetWorthChart.tsx` still plots the new snapshot — 4dbd505

### Phase 2: Test runner + first unit test (commit 2)

#### Automated

- [x] 2.1 `npx vitest --version` exits 0 — 405bac5
- [x] 2.2 `npm run test:run` exits 0 and reports 3 passing tests — 405bac5
- [x] 2.3 `npm run test:run -- --reporter=verbose` lists the `describe` block and all 3 `it` cases by name — 405bac5
- [x] 2.4 TypeScript still compiles: `npx tsc --noEmit` exits 0 — 405bac5
- [x] 2.5 ESLint still passes: `npm run lint` exits 0 — 405bac5
- [x] 2.6 Astro build still succeeds: `npm run build` exits 0 — 405bac5
- [x] 2.7 `test-plan.md` §3 row carries the deferral note for the DOM integration test — 405bac5
- [x] 2.8 `test-plan.md` §6.1 and §6.5 cookbook entries are filled in (no `TBD — see §3 Phase <N>` text remains for Phase 1 sub-sections) — 405bac5
- [x] 2.9 `package.json` has `vitest` in `devDependencies` and `test` + `test:run` in the `scripts` block — 405bac5

#### Manual

- [x] 2.10 `npm run test` enters Vitest watch mode and re-runs on file save — 405bac5
- [x] 2.11 Mutation: flip the liability sign in `computeNetWorth`; confirm the liability-sign guard test fails; revert — 405bac5
- [x] 2.12 Mutation: add `+ 0.0000001` inside `convertAmount`; confirm the clean-oracle test fails; revert — 405bac5
- [x] 2.13 `grep -r "from '@/lib/net-worth'" src/components src/pages/api/snapshots` returns 4 hits — 405bac5
- [x] 2.14 `test-plan.md` §3 row and §6 cookbook entries read correctly in rendered form — 405bac5
