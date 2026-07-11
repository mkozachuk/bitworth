---
date: 2026-06-25T15:00:42+0200
researcher: maksymkozachuk
git_commit: 0322e51bd91bb34f3ba2e10356560ce0609fd612
branch: feature/monte-carlo-simulation
repository: bitworth
topic: "Monte Carlo simulation (S-16) — reuse surface, math correctness, charting & persistence"
tags: [research, codebase, monte-carlo, fire, recharts, simulation]
status: complete
last_updated: 2026-06-25
last_updated_by: maksymkozachuk
---

# Research: Monte Carlo simulation (S-16)

**Date**: 2026-06-25T15:00:42+0200
**Researcher**: maksymkozachuk
**Git Commit**: 0322e51bd91bb34f3ba2e10356560ce0609fd612
**Branch**: feature/monte-carlo-simulation
**Repository**: bitworth

## Research Question

What does the live codebase provide for building S-16, the Monte Carlo "Forecast"
feature — the exact reuse surface on top of the S-09 FIRE engine (engine API, SSR
prefs load, form, chart conventions, nav contract, pure-module + test conventions) —
and what are the correct answers to the three planning-critical sub-questions:
(1) Monte Carlo math correctness (parametric Normal in real terms, Box–Muller,
seedable RNG, clamping, percentiles), (2) Recharts multi-series rendering performance,
and (3) the volatility-persistence decision (session-only vs a persisted column)?

## Summary

S-16 is a thin, additive read-and-compute layer. **Nothing it needs from a data model
or schema standpoint is missing** — it reuses the S-09 FIRE engine, the persisted
`fire_*` prefs, the `dashboard/fire.astro` SSR-load pattern, the Recharts conventions
from `FireProjectionChart`/`AssetTrendsChart`, and the pure-module + table-driven test
discipline from `fire.ts`/`allocation.ts`. The new surface is: **one pure module
(`src/lib/monte-carlo.ts`) + one page (`dashboard/forecast.astro`) + one React island +
one nav item in TWO files + a cross-link on the FIRE page.**

Key confirmed decisions for the planner:

- **Math**: draw each year's return from `Normal(realReturn, volatility)` in **real terms**,
  reusing `toRealReturn` from `fire.ts:51-53` for the mean; transform uniforms with
  **Box–Muller** (guard `u1 = 1 - rng()` to dodge `ln(0)`); generate uniforms with a
  seeded **mulberry32**; compound `balance *= max(0.05, 1 + r)` (floor at −95%); success =
  share of paths with **terminal** balance ≥ FIRE number; bands = per-year sorted
  **linearly-interpolated** P10/P50/P90. The one genuine subtlety to disclose is
  **volatility drag** (median CAGR ≈ `realReturn − σ²/2`).
- **Charting**: single shared `data` array, one row per year, wide columns
  (`{ year, path0…pathN, p10, p50, p90 }`); `dot={false}` + `isAnimationActive={false}` on
  every `<Line>`; ~50–100 faint sampled lines + 3 bold percentile lines + a
  `ReferenceLine y={fireNumber}`. No Web Worker for v1 (60k iterations is trivial); keep
  compute pure so it can move off-thread later.
- **Volatility persistence**: **session-only for v1** (≈3–4 edits, no migration). Persisting
  is a well-trodden 6-touchpoint change that can be layered later.
- **None of `mulberry32`, Box–Muller, or percentile/quantile exist in the codebase** — all
  three are greenfield and must be written (and unit-tested) from scratch.

## Detailed Findings

### Area 1 — FIRE engine reuse surface (`src/lib/fire.ts`)

Pure module, no Supabase/React/I/O, imported on both the Astro SSR server and the React
island (`src/lib/fire.ts:1-12`). Runs entirely in **real (today's-dollar) terms**; converts
nominal→real once and never re-inflates. Raw floats; rounding only at the view edge.

**Exact reuse points for the Monte Carlo recurrence:**

- `toRealReturn(nominalReturn, inflationRate)` — `src/lib/fire.ts:51-53`:
  `return (1 + nominalReturn) / (1 + inflationRate) - 1;` (exact Fisher relation, not the
  `nominal - inflation` approximation). **Reuse this for the MC mean.**
- FIRE-number derivation — `src/lib/fire.ts:86`: `const fireNumber = annualExpenses / safeWithdrawalRate;`
  guarded by `src/lib/fire.ts:81-83` which `throw new RangeError(...)` when `safeWithdrawalRate <= 0`.
  **Reuse this so both projection views agree on the target.**
- Year recurrence (end-of-year ordinary annuity) — `src/lib/fire.ts:104`:
  `balance = balance * (1 + realReturn) + annualSavings;`. The MC layer reimplements this
  same recurrence with a **per-year sampled `r`** instead of the single scalar `realReturn`.
- Horizon — `src/lib/fire.ts:90`: `maxYears ?? Math.max(0, 100 - currentAge)`.
- Types: `FireInputs` (`src/lib/fire.ts:14-25`), `FireProjectionPoint = { age, balance }`
  (`src/lib/fire.ts:27-30`), `FireResult` (`src/lib/fire.ts:32-44`). `FireInputs` has **no
  volatility/stddev field today** — that is the one new input S-16 adds.
- `monthsOfRunway` (`src/lib/fire.ts:151-154`) returns `null` for non-positive/non-finite
  expenses — illustrates the project's "return null for undefined-but-valid" convention.

`computeFireProjection` is fully deterministic, so it is **not** reused per-trial directly;
S-16 reimplements the recurrence with a sampled return (or wraps it). The reuse is the
formulae (Fisher, FIRE number) + conventions, per the roadmap's "both views agree on
assumptions" mitigant.

### Area 2 — SSR prefs load (`src/pages/dashboard/fire.astro`)

The template for a new `dashboard/forecast.astro`:

- Auth gate (`src/pages/dashboard/fire.astro:12-16`): `if (!user) return Astro.redirect("/auth/signin");`
- Supabase client + display currency (`:18-19`); assets load with category join (`:21`);
  `getRates(supabase)` (`:23`); `computeNetWorth(...)` → starting principal (`:27-35`).
- Prefs load with its **own inline `.select(...)`** column list (distinct from the API's
  `PREFS_SELECT`) — `src/pages/dashboard/fire.astro:37-43` — then `.maybeSingle()`.
- Typed-record cast (`:48`): `const firePrefs = (prefs ?? {}) as Record<string, number | null>;`
  (chained selects resolve to `any` in `.astro` frontmatter — per the Currency-cast lesson).
- `Partial<FireInputs>` SSR-load mapping (`:53-63`): each nullable column → a `FireInputs`
  field via `?? undefined`, so the island falls back to its own defaults. Note the field
  renames: `fire_expected_return → nominalReturn`, `fire_safe_withdrawal_rate → safeWithdrawalRate`,
  `fire_starting_principal_override → startingPrincipal`.
- Island handoff (`:80-85`): `<FireCalculatorForm displayCurrency startingPrincipal initialInputs client:load />`.

**For S-16**: `forecast.astro` copies this verbatim. A persisted volatility field would need
adding to BOTH the inline `.select(...)` (`:40`) AND the `initialInputs` map (`:53-63`); a
session-only field touches neither.

### Area 3 — Form island (`src/components/fire/FireCalculatorForm.tsx`)

The template for the Forecast island's input handling:

- Props (`:9-13`): `displayCurrency`, `startingPrincipal`, `initialInputs: Partial<FireInputs>`.
- `FormState` (`:18-28`) mirrors `FireInputs` but holds rates as whole-number percentages
  (`expectedReturnPct` etc.), ÷100 only when feeding the engine/API.
- `DEFAULTS` (`:33-43`): `expectedReturnPct: 7`, `inflationRatePct: 3`, `safeWithdrawalRatePct: 4`,
  `currentAge: 30`, `traditionalRetirementAge: 65`; money fields default `NaN` (blank box).
- `seedState` (`:47-62`), `toInputs(state): FireInputs` (`:64-76`), `num(v)` coerces `NaN→0` (`:45`).
- **Guard-before-call** (`:99-103`): `const swrValid = num(state.safeWithdrawalRatePct) > 0; ... const result = swrValid ? computeFireProjection(inputs) : null;` — guards the precondition
  rather than catching the `RangeError`. **S-16 must do the same** (validate inputs + pass an
  explicit seed before calling the throwing pure module).
- `handleSave` (`:105-140`) PUTs all nine `fire_*` keys to `/api/user-preferences`.
- Fields via a local `NumberField` component (`:334-368`) — a `type="number"` input showing
  `""` for `NaN`. **This is the real precedent for a new volatility input**, not SettingsForm.

A session-only volatility input touches only `FormState`/`DEFAULTS`/`toInputs` + one
`NumberField`; persisting it additionally touches `seedState`/`handleSave`.

### Area 4 — Charting conventions

**`FireProjectionChart.tsx` (closest single-series precedent)** — copy the card chrome and
wiring verbatim:

- Imports (`src/components/fire/FireProjectionChart.tsx:1`):
  `LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine`.
- **Empty-state guard** (`:44-53`): Recharts refuses an empty dataset — return a card with a
  message when there's nothing to plot. S-16 needs the equivalent.
- Card chrome (`:56-62`); `ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}` (`:64`) — `initialDimension` is on every chart (SSR/hydration sizing); reuse it.
- `LineChart margin={{ top: 5, right: 20, left: 10, bottom: 5 }}` (`:65`);
  `CartesianGrid stroke="var(--border)" strokeDasharray="5 5"` (`:66`).
- **Numeric XAxis** (`:67-73`): `dataKey="age" type="number" domain={["dataMin","dataMax"]}` —
  already fits a year/age horizon (unlike the date-string axes elsewhere).
- YAxis currency formatter via `toLocaleString` (`:74-82`); custom `Tooltip content={<CustomTooltip .../>}` (`:83`, def `:13-39`).
- `Line type="monotone" dataKey="balance" stroke="var(--chart-1)" dot={false} strokeWidth={2}` (`:84`).
- **`ReferenceLine` at the FIRE number** (`:85-94`): `y={fireNumber} stroke="var(--chart-3)" strokeDasharray="3 3" label={{ value: "FIRE number", ... position: "insideTopRight" }}`.

**`AssetTrendsChart.tsx` (closest multi-series precedent — the model for many MC paths)**:

- Multi-series **data shape** (`src/components/AssetTrendsChart.tsx:137-144`): one row object per
  X-point, one key per series, `null` for gaps.
- Mapped multi-`<Line>` render (`:222-233`): `{lines.map(({ asset }, i) => <Line key dataKey={asset.id} stroke={assetColor(i, lines.length)} dot={false} strokeWidth={2} connectNulls={false} />)}`.
- Distinct-color helper for an **unbounded** series count — `src/lib/asset-trends.ts:103-107`:
  `assetColor(index, total)` → evenly-spaced HSL hues. (For faint MC paths, a single
  low-opacity stroke is more likely; reserve `--chart-*` for the percentile lines.)

**Color tokens** — `src/styles/global.css`: five `--chart-1..5` oklch vars, themed for light
(`:28-32`) and dark (`:62-66`), exposed as Tailwind utilities via `@theme inline` (`:100-104`).
Also `var(--border)` and `var(--muted-foreground)` for grid/ticks. `BalancerView.tsx:28-29`
shows the `CHART_COLORS` array + `colorFor(i)` indexing pattern.

### Area 5 — Navigation contract (BOTH files — per the documented lesson)

Current nav items (identical order in both): **Dashboard, Assets, Balance, FIRE, Settings**.
A new "Forecast" item goes right after FIRE in **both** files:

- **Desktop** `src/components/Topbar.astro:34-39` — plain `<a>` (no icon), e.g.
  `href="/dashboard/fire"` with the purple link classes; insert a parallel block for
  `/dashboard/forecast`. No active-route highlighting exists.
- **Mobile** `src/components/TopbarMenu.tsx` — Radix dropdown. Lucide icons imported at `:3`
  (`Menu, LayoutDashboard, FileText, Scale, Flame, Settings, LogOut`); a Forecast item needs a
  new import (e.g. `TrendingUp` / `Dices` per roadmap). Mirror the item block (`:64-69`):
  `<DropdownMenu.Item asChild><a href="..." className={itemClass}><Flame className="size-4" /> FIRE</a></DropdownMenu.Item>`.

### Area 6 — Page/route structure (`dashboard/forecast.astro` template)

Files under `src/pages/dashboard/`: `assets/`, `balancer.astro`, `fire.astro`, `settings.astro`.
Template from `fire.astro`: `import Layout from "@/layouts/DashboardLayout.astro"` (`:2`); auth
guard (`:12-16`); Supabase client + `displayCurrency` + `getRates` (`:18-23`); React island via
`client:load` (`:80-85`); page chrome — centered `max-w-4xl`, gradient `<h1>`, bordered
glass card. `DashboardLayout.astro` renders `<Topbar />` + `<slot />`, so a new nav item
automatically surfaces on the page.

### Area 7 — Pure-module & test conventions (for `src/lib/monte-carlo.ts` + its test)

**Module style** (mirror `fire.ts`/`allocation.ts`/`movers.ts`/`net-worth.ts`):
top-of-module `//` contract header; exported `interface` types before functions; `camelCase`
`compute*` entry points; JSDoc per function stating the formula and the throw-vs-null decision;
guard clauses first; **throw `RangeError`/`TypeError` only for structurally-invalid
(divide-by-zero-class) input**, **return `null` for "undefined but valid"**; a shared
`EPSILON = 1e-2` if a near-zero guard is needed (`allocation.ts:22`, `movers.ts:7`).

**Test style** (mirror `fire.test.ts` etc.):

- `import { describe, expect, it } from "vitest";`, one `describe` per function; oracle
  discipline comment ("computed from first principles — never by reading the implementation",
  e.g. `src/lib/fire.test.ts:5-13`).
- Dominant table mechanism is an **`overrides` fixture factory** (`fire.test.ts:16-28`), not
  `it.each`; the one `it.each` table is `crypto-prices.test.ts:123-126` (`$symbol` title
  interpolation) — the pattern to use for tabulating MC percentiles across seeds/inputs.
- **Float assertions**: `toBe` for provably-exact integers/short-circuits; **`toBeCloseTo(_, 6)`
  for any division/growth/exponentiation** (`fire.test.ts:11-13`, `:33`). MC percentiles/
  distributions assert with `toBeCloseTo(_, 6)` against an oracle from a **fixed seed**. Throw
  path: `expect(() => ...).toThrow(RangeError)` (`fire.test.ts:180`). Include a "333.33-class FP
  probe" to catch ×100/÷100 scaling regressions.
- **Vitest config** (`vitest.config.ts`): `test.environment: "node"` (`:31`); `tsconfigPaths()`
  plugin (`:2`, `:28`) makes the `@/*` alias resolve — **test files import via `@/lib/monte-carlo`**
  (lib *source* modules import each other with relative paths). `test.include: ["src/**/*.test.{ts,tsx}"]`
  auto-discovers `src/lib/monte-carlo.test.ts`.
- **Consumption pattern**: the island keeps a `FormState`, maps via `toInputs`, and
  **guards before calling** the throwing pure module (`FireCalculatorForm.tsx:99-103`).

**No RNG/Gaussian/percentile exists** anywhere in `src/` (no `Math.random`, no `mulberry32`,
no Box–Muller, no quantile). `FireCalculatorForm.tsx:47` `seedState(...)` is form-state init,
not an RNG. All three primitives are greenfield.

### Area 8 — Monte Carlo math correctness

1. **Real-terms draws are internally consistent** and avoid the nominal/real mixing bug —
   compounding real returns keeps balances in today's dollars, comparable to the today's-dollars
   FIRE number. Pitfalls to state: future **contributions must also be real** (a constant real
   contribution is the clean choice; flat-nominal must be deflated by `(1+infl)^year`); and
   **volatility is treated as the real-terms sd** (numerically ≈ nominal sd because inflation
   variance is small — defensible for v1).
2. **Volatility drag is the one genuine trap.** Drawing `r ~ Normal(μ, σ)` and compounding
   `balance *= (1+r)` yields a median long-run CAGR ≈ `μ − σ²/2`. v1 recommendation: treat the
   user's `realReturn` as the **arithmetic** mean and **disclose** the `−σ²/2` drag in the
   help/disclaimer. (Optional more-honest variant: up-convert `arithMean = geoMean + σ²/2`.
   Log-normal draws — `balance *= exp(z)` — are the rigorous future option and also remove the
   need for the clamp.)
3. **Box–Muller**: `z0 = sqrt(-2*ln(u1)) * cos(2π*u2)`, then `x = mean + sd*z0`. Guard the
   `ln(0)` edge with `u1 = 1 - rng()` (maps `[0,1)` → `(0,1]`).
4. **mulberry32**: canonical tiny seedable PRNG returning `[0,1)`; full 2³² period, ample for
   ~10⁵–10⁶ draws; **not cryptographic**. Its virtue is determinism → reproducible, unit-testable
   runs. Fix the seed in tests.
5. **Clamp** `balance *= max(0.05, 1 + r)` (≥ −95%/yr) enforces limited liability. Bias is
   negligible (a < −95% draw is a ~−5.5σ to −7σ event), but **disclose** the slight left-tail
   truncation (marginally optimistic).
6. **Success metric**: for an accumulation calculator, use **terminal-wealth** success —
   `share of paths with balance ≥ FIREnumber at the END of the horizon`. ("At or before"
   over-counts because a path can cross then fall back.) If a decumulation phase is added later,
   switch to "balance > 0 through horizon" (Trinity-study definition) — flag as future.
7. **Percentile bands**: build a `paths[i][year]` matrix; for **each year index**, sort the N
   balances and take the quantile (cross-sectional, per-year — this makes the widening fan). Use
   **linear interpolation** (type-7: `rank = p*(N-1)`, interpolate between `floor`/`ceil`) for
   smooth bands; nearest-rank (`ceil(p*N)-1`) is also acceptable. Pick one and be consistent.

### Area 9 — Recharts multi-series performance (Context7-cited)

(Sources: Recharts docs via Context7 — `/recharts/recharts`, `/websites/recharts_github_io`;
API pages Line / ReferenceLine / ResponsiveContainer; animations guide; `CompareTwoLines`,
`LineChartWithReferenceLines`, `LineChartHasMultiSeries` examples.)

- **Disable animation — biggest win.** Set `isAnimationActive={false}` on **every** `Line`
  (default is `"auto"` = on in the browser); the entrance animation across 50–100 series is the
  main jank source.
- **Disable dots.** `dot` defaults to `true`; ~60 points × 100 lines = ~6,000 SVG circles. Set
  `dot={false}` on all lines (sampled and percentile).
- **Faint vs bold**: sampled lines at low `strokeOpacity` (~0.1–0.15), `strokeWidth={1}`,
  `legendType="none"` (avoid 100 legend entries); percentile lines full-opacity, `strokeWidth ~2.5`,
  distinct colors, with legend.
- **Data shape**: use a **single shared `data` array, one row per year, wide columns**
  (`{ year, path0…pathN, p10, p50, p90 }`), every `<Line dataKey="...">` reading from chart-level
  `data`. This is the idiomatic/performant shape (the percentile-band examples use it). **Avoid**
  the per-`Line` separate-`data` pattern (`LineChartHasMultiSeries`) — it needs
  `allowDuplicatedCategory={false}` and reconciles multiple category arrays (a shared-x-axis footgun).
- **`ReferenceLine y={fireNumber}`** renders a horizontal line at a domain value; `strokeDasharray="3 3"`,
  `label="FIRE target"`. With a single Y-axis, **no `yAxisId` needed** (it's required only with
  explicit multi-axis). Use `ifOverflow="extendDomain"` if the target can fall outside the auto domain.
- **`ResponsiveContainer`**: `width="100%"` + fixed `height`, plus `debounce={50}` so resize
  drags don't re-layout the heavy chart every pixel.
- **`syncId`** is for cross-chart tooltip sync, **not** perf — irrelevant here. Recharts has
  **no built-in virtualization**; the lever is element count, not virtualization. SVG handles
  50–100 lines × ~60 points fine with dots/animation off.
- **Tooltip**: a 100-series payload is heavy and useless — disable for the sampled series or use
  a custom `content` reading only `p10/p50/p90`.
- **Web Worker — not for v1.** 1,000 paths × ~60 yr = ~60k iterations is sub-ms to a few ms,
  well under the 16ms frame budget. Threshold where a worker helps: tens of millions of draws,
  or recompute-on-every-slider-drag, or per-asset correlated/fat-tailed draws. Keep compute in a
  pure seeded function so it can be lifted off-thread later with zero call-site change; debounce
  inputs regardless.

## Code References

- `src/lib/fire.ts:51-53` — `toRealReturn` (Fisher); reuse for the MC mean
- `src/lib/fire.ts:81-86` — SWR `RangeError` guard + FIRE-number derivation
- `src/lib/fire.ts:104` — the `balance = balance * (1 + realReturn) + annualSavings` recurrence to re-implement with a sampled return
- `src/lib/fire.ts:14-44` — `FireInputs` / `FireProjectionPoint` / `FireResult` types (no volatility field today)
- `src/pages/dashboard/fire.astro:37-63` — inline prefs `.select(...)` + `Partial<FireInputs>` SSR-load mapping (template for `forecast.astro`)
- `src/components/fire/FireCalculatorForm.tsx:99-103` — guard-before-call pattern for a throwing pure module
- `src/components/fire/FireCalculatorForm.tsx:334-368` — `NumberField` precedent for a volatility input
- `src/components/fire/FireProjectionChart.tsx:1-94` — full Recharts wiring + numeric XAxis + ReferenceLine to copy
- `src/components/AssetTrendsChart.tsx:137-144,222-233` — multi-series data shape + mapped `<Line>` render (model for MC paths)
- `src/lib/asset-trends.ts:103-107` — `assetColor(i, total)` HSL helper for unbounded series
- `src/styles/global.css:28-32,62-66,100-104` — `--chart-1..5` tokens
- `src/components/Topbar.astro:34-39` — desktop nav item to mirror
- `src/components/TopbarMenu.tsx:3,64-69` — mobile nav item + Lucide import to mirror
- `src/lib/fire.test.ts:5-13,16-28,180` — oracle discipline, fixture-factory, throw-path assertion
- `src/lib/crypto-prices.test.ts:123-126` — the one `it.each` table (for percentile/seed tables)
- `vitest.config.ts:2,28,30-31` — `tsconfigPaths`, node env, test include glob
- `supabase/migrations/20260611120000_user_preferences_fire.sql:12-30` — `fire_*` columns (volatility-persistence template)
- `supabase/migrations/20260623120000_user_preferences_show_fire_dashboard.sql:11` — single-column migration (minimal template)
- `src/pages/api/user-preferences/index.ts:15-18,47-57,70-102` — `PREFS_SELECT`, `FIRE_FIELD_SPECS`, `parseFireUpdates`

## Architecture Insights

- **Single real-terms convention is the load-bearing invariant.** S-09 deliberately converts
  nominal→real once (`toRealReturn`) and never re-inflates; this is what prevented the
  nominal/real mixing bug. S-16 must keep the same convention end-to-end (mean, volatility,
  contributions, and target all in today's dollars) or the headline probability is wrong.
- **Pure-module + injected-seed is the testability seam.** Every numeric concern in this app
  lives in a pure, node-environment, float-returning `src/lib/*.ts` module with table-driven
  tests; the React island is a thin adapter that guards preconditions before calling. S-16's
  stochastic module fits this exactly **only because** the RNG is injected — a fixed seed makes
  the distribution/percentiles assertable with `toBeCloseTo(_, 6)`. (Worth a new lesson once
  implemented: seed-injected RNG as the testability seam for any stochastic module.)
- **Throw-vs-null discipline**: throw `RangeError` for divide-by-zero-class input (SWR ≤ 0),
  return `null` for undefined-but-valid. S-16 should reuse the SWR guard before deriving the
  FIRE number.
- **Charts share one card chrome + token set.** Reusing `FireProjectionChart`'s wrapper, axes,
  custom tooltip, and `--chart-*`/`--border`/`--muted-foreground` tokens keeps the Forecast page
  visually consistent for free; the only new wiring is the mapped many-line render borrowed from
  `AssetTrendsChart`.
- **Nav is duplicated across desktop/mobile** (documented lesson) — both `Topbar.astro` and
  `TopbarMenu.tsx` must get the Forecast item or it's unreachable on one breakpoint.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:327-345` — the S-16 slice with its detailed implementation
  sketch, unknowns, and risk register (this research reifies/confirms those recommendations).
- `context/foundation/roadmap.md:207-222` — S-09 FIRE calculator slice (the engine S-16 reuses);
  status done, implemented 2026-06-11 → `context/changes/fire-calculator/`.
- `context/foundation/roadmap.md:255-269` — S-12 per-asset trends (the multi-series chart whose
  pattern S-16 borrows for sampled paths).
- `context/foundation/lessons.md:91-99` — "Nav items live in two files" — both `Topbar.astro`
  and `TopbarMenu.tsx` must be edited for a new nav entry.
- `context/foundation/lessons.md:26-33` — Currency cast boundary (`as Currency` at the SSR/DB
  edge) — applies to any prefs/assets read in `forecast.astro`.
- `context/foundation/lessons.md:35-43` — `vite-tsconfig-paths` is required for the `@/*` alias
  under Vitest (already configured; do not remove).

## Related Research

None prior for this change (`research.md` is the first artifact under
`context/changes/monte-carlo-simulation/`).

## Open Questions

These are the remaining **product/planning decisions** to lock during `/10x-plan` — the research
gives a recommendation for each, but the call is the planner's:

1. **Volatility persistence**: confirm **session-only for v1** (recommended — ~3–4 edits, no
   migration) vs persisting `fire_return_volatility` now (6 touchpoints: migration →
   `database.types.ts` → `PREFS_SELECT` → API validation → `fire.astro` ×2 → form seed+save).
2. **Volatility default & range**: roadmap suggests ~0.15 for an equity-heavy portfolio. Confirm
   the default and the UI bounds (e.g. 0–60%). Decide whether it's a pct-style field (`returnVolatilityPct`)
   like the other rates in `FormState`.
3. **Arithmetic vs geometric mean** for the user's `realReturn` input: recommend treating it as
   the **arithmetic** annual mean and disclosing the `−σ²/2` volatility drag. Confirm the
   disclosure copy (it materially affects how the median reads).
4. **Success metric wording**: lock the exact headline — "share of N paths with terminal balance
   ≥ FIRE number at the horizon." Decide whether to also report **median years-to-FI across
   successful paths** (roadmap suggests considering it).
5. **Path count & sample size**: confirm N = 1,000 computed paths and ~50–100 rendered sampled
   lines; `log`/surface the cap ("sampled 100 of 1,000") so truncation is visible, not silent.
6. **Quantile method**: linear-interpolation (type-7) vs nearest-rank for P10/P50/P90 — recommend
   linear interpolation for smooth bands; just pick one and keep it consistent.
7. **Route & label**: `/dashboard/forecast` + "Forecast" (recommended) vs `/dashboard/monte-carlo`;
   Lucide icon `Dices` vs `TrendingUp`. Add the cross-link on `dashboard/fire.astro`.
8. **First-visit degrade**: if `fire_*` prefs are unset, fall back to `FireCalculatorForm`
   defaults and/or prompt the user to set up FIRE first (link back to `/dashboard/fire`).
9. **Disclaimers**: carry the S-09 "estimate, not financial advice" disclaimer, plus the
   left-tail-clamp and volatility-drag notes.
