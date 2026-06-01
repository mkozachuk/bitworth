---
date: 2026-06-01T22:55:00+02:00
researcher: Claude
git_commit: 0897a0bfd7ec99b264c3c9d632769241180f90e0
branch: master
repository: bitworth
topic: "Phase 1 — bootstrap Vitest and ground the first net worth unit test"
tags: [research, codebase, vitest, net-worth, risk-1, testing-runner-bootstrap]
status: complete
last_updated: 2026-06-01
last_updated_by: Claude
---

# Research: Phase 1 — bootstrap Vitest and ground the first net worth unit test

**Date**: 2026-06-01T22:55:00+02:00
**Researcher**: Claude
**Git Commit**: `0897a0bfd7ec99b264c3c9d632769241180f90e0`
**Branch**: `master`
**Repository**: `mkozachuk/bitworth`

## Research Question

What does Phase 1 of `context/foundation/test-plan.md` actually have to install, extract, and assert? The change is a single rollout phase: bootstrap Vitest and ship the first unit test on the net worth calculation (Risk #1). Research must ground:

1. The **exact location** of the net worth calculation (and why it is **not** in `src/lib/utils.ts`).
2. The **shape of the function** the test will target (signature, inputs, outputs).
3. An **independent oracle value** for a known mixed-currency + liability input.
4. The **minimal Vitest install** for the current Astro v6 + React 19 + Vite 7 + TypeScript 5 stack.
5. What the plan's "small integration test on the dashboard render of the total" actually means, given that the dashboard ships props to a React island (the total is **not** server-rendered).

## Summary

Three findings dominate the phase and must shape the plan:

1. **The net worth formula is duplicated 4× in the codebase and is not in a shared module.** It lives inside `NetWorthDisplay.tsx` (lines 17–26 helper, 148–160 IIFE), `AssetsSummary.tsx` (lines 13–22, 32–38 — *no* liability split), `AssetRow.tsx` (lines 15–24 — single-asset), and `pages/api/snapshots/index.ts` (lines 98–119). The plan cannot write a unit test until a pure module exists. **Phase 1 must first extract** `convertAmount` and `computeNetWorth` into a new `src/lib/net-worth.ts`; the test then lives at `src/lib/net-worth.test.ts` next to it.

2. **The "small integration test" cannot target the dashboard as server-rendered HTML.** `src/pages/dashboard.astro:20-31` fetches data server-side but does not compute the total; it hands raw `assets`, `rates`, `displayCurrency` to a `client:load` React island. The formatted dollar figure only appears after React hydrates. No DOM testing library, no jsdom, no happy-dom is installed. The integration test for Risk #1 must be deferred to a follow-up phase that installs `@testing-library/react` + `jsdom`; the Phase 1 plan should call this out explicitly so it does not get silently expanded.

3. **The Vitest install is minimal and well-bounded.** Just `vitest` as a devDependency (Vite 7 / Astro 6 / ESM-native, no transform pipeline), one `vitest.config.ts` at the repo root pointing `include: ["src/**/*.test.ts"]`, two new scripts (`test` and `test:run`). No DOM, no MSW, no @testing-library — none of those are required for the first test. The legacy `@astrojs/test` / `@astrojs/test-utils` packages no longer exist in Astro v6; do not reference them.

The formula itself is straightforward: `amount / rates[from] * rates[to]` with a same-currency short-circuit; liabilities stored positive, sign flipped at sum time via `category.is_liability`. An independent oracle for `{ USD:1, EUR:1.0, PLN:4.0 }` rates and inputs `1000 USD + 500 EUR + 2000 PLN − 300 USD liability` yields `1000 + 500 + 500 − 300 = 1700` exactly. The first test must hold this value (computed from first principles, not by reading the implementation) and use at least one of each currency to force the conversion branch to fire.

## Detailed Findings

### 1. The net worth calculation — four copies, no shared module

The single most important finding. The pure function the test plan wants to unit-test **does not exist as a standalone function**. It is buried inside a React component, replicated across three other files, and slightly inconsistent in at least one place.

- **Client dashboard display**: [`src/components/assets/NetWorthDisplay.tsx:17-26`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/components/assets/NetWorthDisplay.tsx#L17-L26) defines `convertAmount` as a module-local helper. Lines 148–160 use it in an IIFE to compute `currentNetWorth = totalAssets - totalLiabilities`. The same helper is **reused inline at lines 210–215 and 222–225** to render the per-side subtotals.
- **Per-currency breakdown**: [`src/components/assets/AssetsSummary.tsx:13-22`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/components/assets/AssetsSummary.tsx#L13-L22) redefines `convertAmount` identically. The per-currency loop at lines 32–38 **does not split liabilities** (it sums all assets by currency), and explicitly guards `!(currency in byCurrency) continue;` (line 34). The other three sites do not have this guard, so a foreign-currency asset with an unrecognised code would silently produce a `NaN` total there.
- **Single-row display**: [`src/components/assets/AssetRow.tsx:15-27`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/components/assets/AssetRow.tsx#L15-L27) defines a `convertAmount`-shaped helper for a single asset. Same formula, same shape.
- **Server-side snapshot persistence**: [`src/pages/api/snapshots/index.ts:98-119`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/pages/api/snapshots/index.ts#L98-L119) declares the same `convertAmount` and runs the same IIFE, then writes `totalNetWorth` into the new `snapshots` row. The same loop is reused again at line 150 to compute `converted_amount` per snapshot item.

`src/lib/utils.ts` contains only `cn()` (class-name merge) and is the wrong target for extraction. The extracted module should be a new file, e.g. `src/lib/net-worth.ts`, with two exported functions:

```ts
export function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: Currency,
  rates: Record<Currency, number>,
): number;

export function computeNetWorth(
  assets: AssetWithCategory[],
  displayCurrency: Currency,
  rates: Record<Currency, number>,
): number; // returns totalAssets - totalLiabilities
```

After extraction, the four call sites import from this module. The Phase 1 plan should call this extraction out as a prerequisite of the test, not bundle it silently — it is a real refactor that the test then pins.

### 2. Currency conversion call sites

The fetcher: [`src/lib/exchange-rates.ts:46`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/lib/exchange-rates.ts#L46) `getRates(supabase): Promise<Record<Currency, number>>`. Returns `{ USD: 1.0, EUR: 1/eurUsd, PLN: eurPln/eurUsd }` (lines 78–82). 1-hour cache (`CACHE_TTL_SECONDS = 3600`, line 11). Try/catch swallows network errors and falls back to `STATIC_RATES = { USD: 1.0, EUR: 0.92, PLN: 3.85 }` (lines 5–9, 83–85). `STATIC_RATES` is also the no-auth fallback exposed by `src/pages/api/rates.ts:10`.

**The fetcher is irrelevant to the first unit test.** The test target is the pure function `convertAmount`, which takes a pre-built `rates` object. No Supabase, no fetch, no async. The plan should not confuse these two layers.

### 3. Amount unit handling — plain numbers, no cent scaling

From [`src/lib/database.types.ts:50-63`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/lib/database.types.ts#L50-L63) the `assets.Row` shape is:

```ts
{ amount: number; category_id: string; created_at: string;
  crypto_symbol: string | null; currency: string; id: string;
  name: string; notes: string | null; quantity: number | null;
  updated_at: string; user_id: string; }
```

The SQL column is `NUMERIC(18, 2) NOT NULL` ([`supabase/migrations/20260529190856_initial_schema.sql:33`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/supabase/migrations/20260529190856_initial_schema.sql#L33)) — up to 9,999,999,999,999,999.99. **No `toMajor()` / `toMicro()` / ×100 anywhere in the source.** The API POST at `src/pages/api/assets/index.ts:105-121` parses with `parseFloat` and stores the raw number.

The test should use plain `number` inputs and **must not assume any cent scaling**. A non-round input like `333.33 EUR` is a deliberate probe: if a future maintainer introduces ×100 / ÷100, the test fails.

### 4. Liability sign convention — flipped at sum time, not at storage

Source of truth: `asset_categories.is_liability: boolean` ([`src/lib/database.types.ts:29`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/lib/database.types.ts#L29)). No `LIABILITY_CATEGORY` constant exists. Liability rows store `amount` as a **positive** number; the sign flip happens at the sum site (`NetWorthDisplay.tsx:153-156`, `snapshots/index.ts:113-117`) by branching on `category.is_liability`.

The first test must hold: **a positive liability amount must produce a strictly lower total than the same input as an asset.** This catches the "treat liability as positive" failure mode in the risk response guidance.

### 5. Crypto integration — a real gap, not a bug

`src/lib/crypto-prices.ts:137-168` exposes `getPrice(supabase, symbol)` and is only hit by `/api/crypto-price`. **The net worth path never calls it.** A row with `crypto_symbol: "BTC"`, `amount: 0.5`, `currency: "USD"` contributes `0.5 USD` to the total, not 0.5 × current BTC price. The `quantity` column (added in migration 2) is purely a display label ([`AssetRow.tsx:44-51`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/components/assets/AssetRow.tsx#L44-L51)).

This is a **design constraint, not a bug** — the test should reflect what the code does (treat `amount` as already in fiat) and document the constraint in the test fixture comment, not assert against the missing price-lookup. A future test that wants to cover crypto valuation properly belongs to Risk #4 / #6 territory (Phase 3).

### 6. Data model — schema constraints the test must respect

From [`supabase/migrations/20260529190856_initial_schema.sql:28-39`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/supabase/migrations/20260529190856_initial_schema.sql#L28-L39):

| Column | SQL type | Notes |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | L29 |
| `user_id` | `UUID NOT NULL FK auth.users(id) ON DELETE CASCADE` | L30 — RLS key |
| `category_id` | `TEXT NOT NULL FK asset_categories(id)` | L31 |
| `name` | `TEXT NOT NULL` | L32 |
| `amount` | **`NUMERIC(18, 2) NOT NULL`** | L33 |
| `currency` | `TEXT NOT NULL CHECK (currency IN ('PLN','USD','EUR'))` | L34 |
| `crypto_symbol` | `TEXT` (nullable) | L35 |
| `notes` | `TEXT` (nullable) | L36 |
| `quantity` | `NUMERIC` (nullable, migration 2 L43) | — |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | L37-38, auto-bumped by trigger L115 |

RLS at lines 84–96: `ENABLE ROW LEVEL SECURITY` + policy `auth.uid() = user_id` for **ALL** ops on `assets`. Per-user isolation is enforced at the DB — out of scope for Risk #1.

`asset_categories` (lines 18–25) holds `is_liability BOOLEAN NOT NULL DEFAULT FALSE`. **There is no migration that seeds categories** — they are inserted out-of-band per the schema comment at line 17. The test must therefore use the joined `category: { is_liability: boolean, ... }` inline on fixture objects, **not** assert against a hard-coded category id like `"loans"`. The oracle test cares about the boolean, not the string.

### 7. API surface

`GET /api/assets` ([`src/pages/api/assets/index.ts:34-56`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/pages/api/assets/index.ts#L34-L56)) returns `200 { data: Array<Asset & { category: AssetCategory }> }`, ordered `created_at DESC`. Select embed: `select("*, category:asset_categories(*)")` (line 36). **No `display_currency` field, no pre-converted amount** — the API returns raw rows; conversion is the consumer's job. Error shape follows the project hard rule `{ error: { code, message } }` (L7-8).

`/api/assets/[id]/index.ts` has **no GET handler** — only `PUT` and `DELETE`. Per-row retrieval must go through the list endpoint or Supabase directly.

`/api/categories` ([`src/pages/api/categories/index.ts:8-53`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/pages/api/categories/index.ts#L8-L53)) reads from the DB (not hardcoded), ordered `is_liability ASC, display_order ASC` (L36-37).

### 8. Dashboard display path — no server-rendered total

[`src/pages/dashboard.astro:20-31`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/pages/dashboard.astro#L20-L31) does the data fetching in the frontmatter but **never computes the total**. The page just hands the raw `assets`, `rates`, `displayCurrency` array to a `client:load` island (lines 45–68). The HTML response therefore contains the *props* (serialised into the island) but **not a formatted dollar figure** — the total only appears after React hydrates.

Display rules (the only stable strings the test could match on):

- [`NetWorthDisplay.tsx:200-203`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/components/assets/NetWorthDisplay.tsx#L200-L203) — total rendered with `currentNetWorth.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })` followed by the currency code (e.g. `"1,000.00 USD"`). Negative sign comes from `toLocaleString` itself; the colour flips to red-300 below zero.
- The chart at [`NetWorthChart.tsx:50-54`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/components/NetWorthChart.tsx#L50-L54) reads `total_net_worth` directly from the DB row — it is **structurally independent** of the React IIFE. The total is not overlaid on the chart.
- Delta indicators ([`NetWorthDisplay.tsx:163-189`](https://github.com/mkozachuk/bitworth/blob/0897a0bfd7ec99b264c3c9d632769241180f90e0/src/components/assets/NetWorthDisplay.tsx#L163-L189)) are computed from `snapshot.total_net_worth`, **not** re-derived in display currency — a latent bug if a user's display currency differs from snapshot storage currency, but out of scope for Risk #1.

### 9. What the "small integration test" can actually target in Phase 1

The risk response guidance says the calculation test must be accompanied by a "small integration test on the dashboard render of the total." Three options, in order of cost:

1. **React component render test** — render `<NetWorthDisplay assets={...} displayCurrency="USD" rates={...} />` into a DOM, assert the `<p class="...text-4xl...">` text matches the oracle. Needs `@testing-library/react` + `jsdom` (or `happy-dom`) + JSX transform. **None installed.**
2. **HTTP route render test** — fetch `/dashboard` (authenticated) and assert the formatted total appears in the hydrated HTML. Needs `playwright` or fetch + jsdom pipeline. **Not installed.**
3. **Pure-function extraction** (cheapest, recommended for Phase 1) — pull the IIFE at `NetWorthDisplay.tsx:148-160` (and `convertAmount`) into `src/lib/net-worth.ts`, then a unit test of `computeNetWorth(assets, displayCurrency, rates)` covers the calculation. The "small integration test" is then a *deferred* follow-up that needs option 1 or 2.

**Recommendation for the Phase 1 plan**: ship the pure-function unit test in this phase and explicitly mark the DOM-render test as out-of-scope. The `test-plan.md` §3 row for Phase 1 should be edited (or the plan should leave a note in §6 cookbook) to acknowledge that "small integration test on dashboard render" is deferred until a phase installs DOM tooling. This is consistent with §5 of `test-plan.md` (gates marked `required after §3 Phase <N>` are gated to the phase that wires them).

## Independent oracle

For a unit test that an independent reviewer could re-derive by hand, pick rates that produce clean math:

```ts
const rates = { USD: 1, EUR: 1.0, PLN: 4.0 };
const displayCurrency = "USD";
// inputs: 1000 USD asset, 500 EUR asset, 2000 PLN asset, 300 USD liability
```

- 1000 USD asset: `from === to` short-circuit → `1000` (exercises the no-op branch)
- 500 EUR asset: `500 / 1.0 * 1` = `500` (exercises the conversion branch with a foreign source)
- 2000 PLN asset: `2000 / 4.0 * 1` = `500` (exercises the conversion branch with a *third* currency)
- 300 USD liability: `300` (added to `totalLiabilities`)
- Expected: `totalAssets (2000) - totalLiabilities (300) = 1700` exactly, no FP drift

A second fixture should use **non-round numbers** to expose any cent-scaling bug:

```ts
const rates = { USD: 1, EUR: 1.1, PLN: 0.25 };
// inputs: 1000 USD + 500 EUR + 2000 PLN − 300 USD liability
// expected: 1000 + (500/1.1) + (2000/0.25) - 300 = 1000 + 454.5454... + 8000 - 300 ≈ 9154.5454...
```

The plan should use the first fixture as the headline assertion (exact equality, no tolerance) and the second as a floating-point probe (use `toBeCloseTo` with appropriate precision). The two together exercise all four risks called out in `test-plan.md` §2 row #1: mixed-currency conversion, liability sign, no cent scaling, and the FP-drift sub-risk.

**The oracle must NOT be derived by reading the implementation.** The plan should re-derive the expected number from the formula and rates on paper, then assert against that.

## Test runner setup plan

**Add (devDependencies only):**

| Package | Version | Why |
|---|---|---|
| `vitest` | `^3.2.0` (latest stable) | The runner. Vite-first, ESM-native, no transform pipeline for TS. |

**Do not add in Phase 1** (explicitly deferred, see `test-plan.md` §4 stack table):

- `happy-dom` / `jsdom` — pure function, no DOM.
- `@testing-library/react` — same reason; no JSX in the first test.
- `msw` — Phase 2 (handler + Supabase stub).
- `@playwright/test` / `playwright` — out of scope this module.
- `@vitest/coverage-v8` — defer until §6 cookbook specifies coverage.
- `@vitest/ui` — optional, not in the minimal path.
- `@types/vitest` — does not exist; `vitest` ships its own types.

**Config file:** create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

No `mergeConfig` with `astro.config.mjs` — Tailwind, React, and the Cloudflare adapter are all irrelevant to a pure-TS calculation. Vite 7 (overridden in `package.json:60`) auto-resolves the `@/*` paths declared in `tsconfig.json:10-11`, so no `vite-tsconfig-paths` is needed.

**Scripts to add to `package.json`** under the existing `scripts` block (lines 6-13):

```json
"test": "vitest",
"test:run": "vitest run"
```

`test` runs in watch mode for local iteration; `test:run` is the one-shot for CI. No conflict with `astro preview` etc. — Astro v6 does not ship a `test` command (the old `astro test` came from the removed `@astrojs/test` integration, confirmed via Context7 `/vitest-dev/vitest`).

**Test discovery:** co-located, `src/**/*.test.ts` next to source. The first test is `src/lib/net-worth.test.ts`, sitting next to the new `net-worth.ts` module. Justification: (a) standard Vitest default, (b) keeps the test next to the module so a future extraction or rename orphans both together, (c) the project does not yet have a `__tests__/` convention to follow.

**TypeScript + ESLint impact:**

- `tsconfig.json`: no change. Use explicit `import { test, expect } from "vitest"` in the test file — avoid the `globals: true` shortcut, which would require `"types": ["vitest/globals"]` and risk the strict `astro/tsconfigs/strict` base.
- `eslint.config.js`: test file is `*.test.ts`, not `.tsx`, so `react-compiler` (line 65) does not fire. `projectService: true` (line 24) will type-check the new file. `@typescript-eslint/no-unused-vars` applies — prefix unused with `_` per the project hard rule.

**CI impact:** none. Phase 4 (`test-plan.md:58`) owns CI wiring; the run script is local-only for Phase 1.

## Architecture Insights

- **The duplication pattern is the bigger story than the missing tests.** Four copies of the same formula in four different files is a maintenance hazard even before testing enters the picture. Risk #1 is the most likely failure mode only because the duplication is so easy to drift. A single extracted function turns one fix into a one-place fix.
- **Client-side conversion, server-side persistence.** The dashboard computes the total in the browser (so the user sees updates without a round-trip), but `POST /api/snapshots` recomputes server-side from the same source rows. If the two implementations diverge, the snapshot's `total_net_worth` will not match what the user just saw on screen — a quiet correctness bug. Extracting to a shared module is the only durable fix; a unit test on the shared module is the only durable check.
- **Currency-code-keyed object is the dominant pattern.** `rates: Record<Currency, number>`, the `(currency in byCurrency)` guard in `AssetsSummary`, the `validCurrencies.includes` check in the snapshot API — every layer treats the currency code as a map key. The test should match that shape and populate all three keys in fixtures.
- **Astro v6 / Vite 7 / Vitest 3 are all first-party compatible.** The legacy `@astrojs/test` / `@astrojs/test-utils` packages are gone. The integration story is now: `npm i -D vitest`, drop a `vitest.config.ts`, run. No framework-specific helper.
- **The "small integration test" in §2's risk response guidance is the test plan's soft spot.** It assumes a DOM test renderer is available; the project has none. Risk #1's protection is materially weaker without it (a refactor that breaks the React display but keeps the pure function correct would pass the unit test). The plan must either install the DOM tooling in Phase 1 (raises scope) or formally defer the integration test to a follow-up phase that does.

## Historical Context (from prior changes)

- `context/changes/asset-management/` — S-01 shipped `convertAmount` inline in the asset components. The duplication we are now flagging originated here. No unit test was added at the time.
- `context/changes/dashboard-snapshots-chart/` — S-02 added the `NetWorthDisplay` IIFE and the `currentNetWorth` re-derivation. Lessons: `context/foundation/lessons.md` §1 (DB multi-table writes must be atomic) and §2 (public API endpoints need explicit auth decisions) — both apply to Phase 2, not directly to Phase 1.
- `context/changes/crypto-price-fetch/` — S-03 added the `crypto_price_cache` table and the `quantity` column to `assets`. Phase 1 must take care that the fixture does not assert against the `quantity` column's effect on net worth (see §5 above — quantity is a display label, not a multiplier).

## Code References

- `src/components/assets/NetWorthDisplay.tsx:17-26` — `convertAmount` helper (line 17-26), IIFE consumer (lines 148-160), per-side subtotals (lines 210-225), delta logic (lines 163-189).
- `src/components/assets/AssetsSummary.tsx:13-22, 32-38` — duplicated helper + per-currency loop (no liability split).
- `src/components/assets/AssetRow.tsx:15-27` — single-asset helper.
- `src/pages/api/snapshots/index.ts:98-119` — server-side recompute, persisted to `snapshots.total_net_worth`.
- `src/pages/dashboard.astro:20-31, 45-68` — server data fetch, `client:load` island handoff.
- `src/lib/exchange-rates.ts:5-9, 11, 46, 78-85` — `STATIC_RATES`, `CACHE_TTL_SECONDS`, `getRates`, return shape + fallback.
- `src/lib/utils.ts:1-7` — `cn` only; **not** the net worth target.
- `supabase/migrations/20260529190856_initial_schema.sql:18-39, 84-96` — `assets` + `asset_categories` schema, RLS policies.
- `supabase/migrations/20260531223101_crypto_price_cache.sql:43` — `quantity` column added.
- `src/lib/database.types.ts:23-31, 50-63` — generated row types.
- `package.json:6-13, 60` — `scripts` block, Vite 7 override.

## Related Research

- `context/changes/dashboard-snapshots-chart/research.md` — S-02 risk #1 in its first form; this Phase 1 research supersedes it on the *test* side but inherits its findings on the data flow.
- `context/changes/asset-management/research.md` — S-01 net worth first appeared here; the duplication was already present.
- `context/archive/` — none directly relevant to Risk #1.

## Open Questions

1. **Should Phase 1 install the DOM tooling for the small integration test, or defer it?** Recommendation: defer (scope discipline). The plan should explicitly call this out in the §3 row for Phase 1.
2. **Should the test file be a single assertion or a small `describe` block?** Recommendation: a `describe('computeNetWorth', ...)` with one happy-path exact-oracle test, one floating-point probe, and one liability-sign assertion. Three tests, ~30 lines.
3. **Does the extraction of `computeNetWorth` belong in Phase 1, or is it a separate refactor that the test should accommodate?** Recommendation: bundle it in Phase 1. The test cannot exist without it; treating it as a separate change adds a coordination cost for no gain.
4. **Fixture style: hand-built literals or a factory?** Recommendation: hand-built literals inline in the test file. A factory would be over-engineering for three tests. Defer until Phase 2 when handler tests will need a richer fixture library.
5. **Should the test cover the `from === to` short-circuit and the missing-currency-key `NaN` behaviour explicitly?** Recommendation: yes for the short-circuit (it's a deliberate optimisation). For the NaN behaviour — the four production sites are inconsistent (AssetsSummary has a guard, the others don't). The test should pin the *current* behaviour of the extracted function (NaN for missing key), and the plan should open a follow-up issue to add the guard everywhere. Out of scope for Phase 1.

## Implications for the Plan

The plan-phase agent should produce a plan that:

1. **Includes a real refactor step** (extract `convertAmount` and `computeNetWorth` to `src/lib/net-worth.ts`) **as the first sub-phase of Phase 1**, before any test is written.
2. **Wires the four call sites** to import from the new module as a second sub-phase. This is the de-duplication the formula has needed all along.
3. **Installs only `vitest`** as a devDependency, adds `vitest.config.ts`, and adds the two scripts.
4. **Writes the first test as three assertions** (clean-oracle exact, FP probe, liability-sign guard) in `src/lib/net-worth.test.ts`.
5. **Explicitly defers the DOM-render integration test** to a follow-up phase. The §3 row for Phase 1 in `test-plan.md` may need a small note or a "deferred DOM integration" sub-bullet. The §6.5 cookbook entry ("Adding a test for the net worth calculation") should be filled in with the location, naming, reference test path, and run command after Phase 1 ships.
6. **Does NOT install MSW, jsdom, happy-dom, @testing-library/react, or playwright** in Phase 1. Document the deferral in the plan.
7. **Does NOT wire CI** in Phase 1. Document that `test:run` is the command Phase 4 will invoke.
8. **Does NOT assert against the missing `quantity` / crypto price path.** The test reflects the design (amount is already fiat) and a comment in the fixture explains why.
