# Monte Carlo Simulation (S-16 "Forecast") Implementation Plan

## Overview

Add a Monte Carlo "Forecast" page to BitWorth that runs N=1,000 randomized market paths over the user's FIRE horizon and reports the **probability of reaching their FIRE goal** (a single headline percentage), a chart plotting a readable **sample** of paths plus P10/P50/P90 percentile bands, and plain-language help with an "estimate, not financial advice" disclaimer. Inputs are seeded from the same persisted `fire_*` assumptions the user already entered in S-09, plus **one new session-only input** for return volatility.

The feature is a thin, additive read-and-compute layer on top of the S-09 FIRE engine. The only genuinely new code is a pure, seed-injected `src/lib/monte-carlo.ts` (parametric Normal real-return draws, clamped, with percentile bands and a terminal-wealth success metric), a `dashboard/forecast.astro` page, a `ForecastView` React island, a `MonteCarloChart` component, a "Forecast" nav item in **both** nav files, and a cross-link on the FIRE page.

## Current State Analysis

What exists today that this plan reuses (all confirmed in `context/changes/monte-carlo-simulation/research.md`):

- **`src/lib/fire.ts`** — a pure, real-terms FIRE engine. `toRealReturn(nominalReturn, inflationRate)` (`:51-53`, exact Fisher relation) and the FIRE-number derivation `annualExpenses / safeWithdrawalRate` guarded by a `RangeError` when SWR ≤ 0 (`:81-86`). The deterministic year recurrence is `balance = balance * (1 + realReturn) + annualSavings` (`:104`). `FireInputs` (`:14-25`) has **no volatility field** — that is the one new input S-16 adds. Horizon default `Math.max(0, 100 - currentAge)` (`:90`).
- **`src/pages/dashboard/fire.astro`** — the SSR template: auth gate (`:12-16`), Supabase client + display currency + `getRates` + `computeNetWorth` → starting principal (`:18-35`), an **inline `.select(...)`** prefs read + `.maybeSingle()` (`:37-43`), typed-record cast (`:48`), and a `Partial<FireInputs>` SSR-load mapping with field renames (`:53-63`). Island handoff via `client:load` (`:80-85`).
- **`src/components/fire/FireCalculatorForm.tsx`** — the island template: `FormState` holds rates as whole-number percentages, ÷100 only at the engine boundary; `DEFAULTS` (`:33-43`); `toInputs(state)` (`:64-76`); the **guard-before-call** pattern (`:99-103`) that validates SWR > 0 before calling the throwing pure module; and the local `NumberField` component (`:334-368`) — the real precedent for a new volatility input.
- **`src/components/fire/FireProjectionChart.tsx`** — the closest single-series Recharts precedent: card chrome, empty-state guard (`:44-53`), `ResponsiveContainer` with `initialDimension` (`:64`), numeric XAxis (`:67-73`), currency YAxis formatter, custom Tooltip, and a `ReferenceLine` at the FIRE number (`:85-94`). **`src/components/AssetTrendsChart.tsx`** — the multi-series precedent: wide-row data shape (`:137-144`) and mapped multi-`<Line>` render (`:222-233`).
- **Nav lives in two files** (documented lesson, `lessons.md:91-99`): `src/components/Topbar.astro:34-39` (desktop `<a>`) and `src/components/TopbarMenu.tsx:3,64-69` (mobile Radix dropdown with Lucide icons). Current items: Dashboard / Assets / Balance / FIRE / Settings.
- **Pure-module + test conventions** (`fire.ts` / `fire.test.ts`): top-of-module contract header, exported `interface` types, `compute*` entry points, throw `RangeError` for divide-by-zero-class input / return `null` for undefined-but-valid; Vitest node env with `vite-tsconfig-paths` (`lessons.md:35-43`), `toBeCloseTo(_, 6)` for any float from division/growth, fixed-seed oracles.

**What's missing:** `mulberry32`, Box–Muller, and any percentile/quantile helper do **not** exist anywhere in `src/` — all three are greenfield and must be written and unit-tested from scratch.

## Desired End State

A signed-in user clicks a new **"Forecast"** nav item (present on both desktop and mobile), lands on `/dashboard/forecast`, and sees:

- A **headline probability** — "X% of 1,000 simulated paths reach your FIRE number" — computed by terminal-wealth success.
- A **chart** with ~100 faint sampled paths, bold P10/P50/P90 percentile bands, and a dashed `ReferenceLine` at the FIRE number.
- A **volatility input** (default 15%) alongside the FIRE assumptions pre-filled from the user's persisted `fire_*` prefs (or sensible defaults + a soft CTA to set up FIRE if unset).
- **Help/disclaimer copy**: what the simulation does, how to read the bands, the volatility-drag note, the left-tail-clamp note, and "estimate, not financial advice."
- A **cross-link** from `/dashboard/fire` to the Forecast page.

**Verification:** `npm run test` (pure-module suite green, including fixed-seed percentile/probability oracles), `npm run lint`, `npm run build` all pass; the page renders, runs, and re-runs deterministically for a given seed; the chart shows the widening fan without jank.

### Key Discoveries:

- Reuse `toRealReturn` (`fire.ts:51-53`) for the MC mean and the FIRE-number derivation (`fire.ts:81-86`) so both projection views agree on the target — the roadmap's "both views agree on assumptions" mitigant.
- The island must **guard before calling** the throwing pure module (`FireCalculatorForm.tsx:99-103`) — validate SWR > 0 and pass an explicit seed.
- A single shared wide `data` array (`{ year, path0…pathN, p10, p50, p90 }`) with `dot={false}` + `isAnimationActive={false}` on every `<Line>` is the performant Recharts shape (research Area 9).
- Nav must touch **both** `Topbar.astro` and `TopbarMenu.tsx` (`lessons.md:91-99`).

## What We're NOT Doing

- **No persisted volatility column** — volatility is session-only for v1 (no migration, no `database.types.ts` / `PREFS_SELECT` / API / `fire.astro` changes). Promote to `fire_return_volatility` later if users want it sticky.
- **No Web Worker** — 1,000 paths × ~60 years ≈ 60k iterations is sub-ms; compute synchronously in the island. Keep the function pure so it can move off-thread later with zero call-site change.
- **No decumulation / Trinity-style "balance > 0 through horizon" metric** — v1 is an accumulation calculator; success is terminal-wealth only. Decumulation is a future switch.
- **No log-normal draws** — v1 uses parametric Normal with a clamp; log-normal is the documented rigorous future option.
- **No bootstrap/historical-resampling return model** — parametric Normal in real terms only.
- **No median years-to-FI stat** — terminal-wealth headline only for v1.
- **No new charting library** — reuse the Recharts conventions from `FireProjectionChart` / `AssetTrendsChart`.

## Implementation Approach

Three phases, each independently verifiable:

1. **Pure module first** (`src/lib/monte-carlo.ts` + test) — the stochastic math is the highest-risk surface, and it's the most cheaply verified in isolation with a fixed seed. Build and prove it before any UI exists.
2. **Page, island, nav, cross-link** — wire the SSR prefs load, the island with the new volatility input, guard-before-call, and the headline probability as text. The page becomes reachable and runs end-to-end; the chart is deferred so this phase has a small, testable surface.
3. **Chart & presentation** — add the multi-series Recharts visualization and the help/disclaimer copy on top of the working page.

The load-bearing invariant across all three: **single real-terms convention end-to-end** (mean, volatility, contributions, and target all in today's dollars), reusing `fire.ts`'s `toRealReturn` and FIRE-number derivation.

## Critical Implementation Details

- **Volatility drag is the one genuine math trap.** Drawing `r ~ Normal(realReturn, σ)` and compounding `balance *= (1+r)` yields a median long-run CAGR ≈ `realReturn − σ²/2`. Decision: treat the user's entered `realReturn` as the **arithmetic** annual mean (matching the S-09 input's existing meaning, so both views agree) and **disclose** the `−σ²/2` drag in the Forecast help copy. Do **not** up-convert. The median band will read below the entered return — that is correct and must be explained, not "fixed."
- **Box–Muller `ln(0)` guard:** generate the first uniform as `u1 = 1 - rng()` (maps `[0,1)` → `(0,1]`) before `sqrt(-2*ln(u1))`. Without this, a `rng()` of exactly 0 yields `ln(0) = -Infinity`.
- **Clamp at `max(0.05, 1 + r)`** (≥ −95%/yr) enforces limited liability. A draw below −95% is a ~−5.5σ to −7σ event so the bias is negligible, but **disclose** the slight left-tail truncation (marginally optimistic).
- **Per-year cross-sectional percentiles, not per-path.** Build a `paths[i][year]` matrix; for **each year index**, sort the N balances across paths and take the quantile. This is what produces the widening fan. Use **type-7 linear interpolation** (`rank = p*(N-1)`, interpolate between `floor`/`ceil`) — pick this and be consistent.
- **Contributions must also be real.** A constant real contribution is the clean choice; the recurrence is `balance = clamp(balance) * (1 + r) + annualSavings` where `annualSavings` is already a today's-dollars value from `FireInputs`.

## Phase 1: Pure Monte Carlo module + tests

### Overview

Write `src/lib/monte-carlo.ts` — the pure, seed-injected stochastic engine — and its fixed-seed table-driven test. No UI. This is the highest-risk surface and is fully verifiable in isolation.

### Changes Required:

#### 1. Monte Carlo pure module

**File**: `src/lib/monte-carlo.ts` (new)

**Intent**: Provide a deterministic-given-a-seed Monte Carlo engine that simulates N real-terms paths over the FIRE horizon, returning the path matrix (for sampled rendering), per-year P10/P50/P90 bands, the FIRE number, and the terminal-wealth success probability. Mirror the `fire.ts` module style (contract header, exported interfaces, `compute*` entry, guard clauses, throw/null discipline). Reuse `toRealReturn` and the FIRE-number derivation from `fire.ts` so both projection views agree.

**Contract**: Export the RNG, Gaussian, and percentile primitives plus the simulation entry point.

- `mulberry32(seed: number): () => number` — canonical tiny seedable PRNG returning `[0,1)`. Not cryptographic; its virtue is determinism.
- `nextGaussian(rng: () => number, mean: number, sd: number): number` — Box–Muller transform: `z0 = sqrt(-2*ln(u1)) * cos(2π*u2)` with `u1 = 1 - rng()` (the `ln(0)` guard), then `mean + sd*z0`.
- `percentile(sortedAscending: number[], p: number): number` — type-7 linear interpolation: `rank = p*(N-1)`, interpolate between `floor`/`ceil`. Document that the input must be pre-sorted ascending.
- `interface MonteCarloInputs extends FireInputs { returnVolatility: number; seed: number; pathCount?: number }` — adds the real-terms annual volatility (decimal, e.g. 0.15), the explicit seed, and an optional path count defaulting to 1000.
- `interface MonteCarloResult { fireNumber: number; horizonYears: number; paths: number[][]; bands: { year: number; p10: number; p50: number; p90: number }[]; successProbability: number; pathCount: number }`.
- `computeMonteCarlo(inputs: MonteCarloInputs): MonteCarloResult` — derive `realReturn = toRealReturn(...)`, derive the FIRE number (reuse `fire.ts`'s guarded derivation; throw `RangeError` when SWR ≤ 0, same as `fire.ts:81-83`), compute the horizon, then for each of `pathCount` paths run the recurrence `balance = max(0.05, 1 + nextGaussian(rng, realReturn, returnVolatility)) * balance + annualSavings` per year (clamp applied to the growth multiplier). Build the per-year bands by sorting each year's cross-section and taking type-7 P10/P50/P90. `successProbability` = share of paths with **terminal** balance ≥ FIRE number. Return raw floats (round only at the view edge, per project convention).

The recurrence and clamp are the non-obvious part — show that one line in the implementation. RNG/Gaussian/percentile are textbook; describe and let the implementer write them.

#### 2. Monte Carlo unit tests

**File**: `src/lib/monte-carlo.test.ts` (new)

**Intent**: Pin every primitive and the end-to-end simulation against first-principles oracles with a fixed seed, mirroring `fire.test.ts` (oracle-discipline comment, fixture-factory for inputs, one `describe` per function).

**Contract**: One `describe` per exported function.

- `mulberry32`: assert the **exact** first few outputs for a known seed (canonical published values) with `toBeCloseTo(_, 6)`; assert outputs stay in `[0,1)`.
- `nextGaussian`: with a fixed-seed `rng`, assert the first transformed value against a hand-computed Box–Muller oracle (`toBeCloseTo(_, 6)`); over many draws assert the sample mean/sd land near `mean`/`sd` within a loose tolerance.
- `percentile`: table of `(sortedArray, p) → expected` covering p=0, p=1, p=0.5, and an interpolated rank (e.g. P10 of a 10-element array) — `toBeCloseTo(_, 6)`. Include a known type-7 example to lock the interpolation choice.
- `computeMonteCarlo`: with a fixed seed and small `pathCount`, assert the **exact** `successProbability` and the P50 terminal band against an oracle computed from the same seed by hand/reference (`toBeCloseTo(_, 6)`); assert `bands` widen (P90−P10 non-decreasing across years in expectation); assert the SWR ≤ 0 throw path with `expect(() => ...).toThrow(RangeError)`; assert determinism (same seed → identical result). Include a "333.33-class FP probe" to catch ×100/÷100 scaling regressions if any percent conversion sneaks in.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check` (or `npx tsc --noEmit`)
- Unit tests pass: `npm run test`
- Linting passes: `npm run lint`

#### Manual Verification:

- A fixed seed produces byte-identical results across two runs (determinism confirmed by the test, spot-checked manually).
- The percentile bands visibly widen year-over-year for a non-zero volatility (sanity check via a scratch log or the test fixtures).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Forecast page, island, nav & cross-link

### Overview

Make the feature reachable and runnable end-to-end: a `dashboard/forecast.astro` page that SSR-loads the persisted `fire_*` prefs (copying the `fire.astro` pattern), a `ForecastView` island that adds the volatility input, guards before calling `computeMonteCarlo`, and renders the **headline probability** as text; the "Forecast" nav item in both nav files; and a cross-link on the FIRE page. The chart is deferred to Phase 3.

### Changes Required:

#### 1. Forecast page (SSR prefs load + degrade-to-defaults)

**File**: `src/pages/dashboard/forecast.astro` (new)

**Intent**: Copy the `fire.astro` SSR scaffold — auth gate, Supabase client, display currency, `getRates`, `computeNetWorth` → starting principal, the inline prefs `.select(...)` + `.maybeSingle()`, the typed-record cast, and the `Partial<FireInputs>` mapping. Hand off to the `ForecastView` island via `client:load`. Page chrome mirrors `fire.astro` (centered `max-w-4xl`, gradient `<h1>`, glass card). If prefs are unset, the island falls back to its own defaults; surface a soft CTA banner linking to `/dashboard/fire`.

**Contract**: Reuse the exact field renames from `fire.astro:53-63` (`fire_expected_return → nominalReturn`, `fire_safe_withdrawal_rate → safeWithdrawalRate`, `fire_starting_principal_override → startingPrincipal`). No volatility column is read (session-only). Apply the Currency cast boundary (`as Currency`) per `lessons.md:26-33` for any currency read. Island handoff: `<ForecastView displayCurrency startingPrincipal initialInputs client:load />`.

#### 2. Forecast island (form state + volatility + headline probability)

**File**: `src/components/forecast/ForecastView.tsx` (new)

**Intent**: Adapt the `FireCalculatorForm` island pattern. Hold a `FormState` mirroring `FireInputs` (rates as whole-number percentages) plus a new `returnVolatilityPct` field. Map to `MonteCarloInputs` via a `toInputs`-style helper (÷100 at the engine boundary, including volatility), generate/hold an explicit seed, **guard before calling** `computeMonteCarlo` (validate SWR > 0, mirroring `FireCalculatorForm.tsx:99-103`), and render the headline probability ("X% of 1,000 simulated paths reach your FIRE number"). Render a soft CTA banner when `initialInputs` is empty (first-visit degrade). The chart slot is added in Phase 3.

**Contract**: New field `returnVolatilityPct` in `FormState` and `DEFAULTS` (default **15**, UI-clamped 0–60), entered via the local `NumberField` precedent (`FireCalculatorForm.tsx:334-368`) — a `type="number"` showing `""` for `NaN`. `toInputs` returns `MonteCarloInputs` with `returnVolatility = returnVolatilityPct / 100`, `seed`, and `pathCount = 1000`. Use a stable seed per render unless inputs change (e.g. seed held in state, re-rolled only on an explicit "re-run" or kept constant so results are reproducible) — keep results deterministic for a given input set. No `handleSave` for volatility (session-only); the existing `fire_*` values are read-only inputs here.

#### 3. Forecast nav item — desktop

**File**: `src/components/Topbar.astro`

**Intent**: Add a "Forecast" link right after the FIRE item, mirroring the existing plain `<a>` block (`:34-39`) with the same purple link classes, `href="/dashboard/forecast"`.

**Contract**: Plain `<a>`, no icon (desktop nav has none). Insert after FIRE, before Settings.

#### 4. Forecast nav item — mobile

**File**: `src/components/TopbarMenu.tsx`

**Intent**: Add a "Forecast" dropdown item right after the FIRE item, mirroring the existing item block (`:64-69`), with a new Lucide `Dices` import (`:3`).

**Contract**: `<DropdownMenu.Item asChild><a href="/dashboard/forecast" className={itemClass}><Dices className="size-4" /> Forecast</a></DropdownMenu.Item>`. Add `Dices` to the Lucide import line.

#### 5. Cross-link from the FIRE page

**File**: `src/pages/dashboard/fire.astro`

**Intent**: Add a link/CTA near the projection chart pointing to `/dashboard/forecast` so the deterministic and probabilistic views cross-reference each other.

**Contract**: A simple styled `<a href="/dashboard/forecast">` with copy like "See the probability of reaching this goal →". Placement near the projection chart card.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- "Forecast" appears in BOTH the desktop nav and the mobile dropdown and routes to `/dashboard/forecast`.
- The page loads pre-filled from persisted `fire_*` prefs; with prefs unset it shows defaults + the soft CTA to `/dashboard/fire`.
- Editing volatility re-computes the headline probability; SWR ≤ 0 does not throw an unhandled error (guarded).
- The FIRE page shows a working cross-link to the Forecast page.
- The headline probability is deterministic for a given input set.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Chart & presentation

### Overview

Add the multi-series Recharts visualization (sampled paths + percentile bands + FIRE-number reference line) and the help/disclaimer copy on top of the working Phase-2 page.

### Changes Required:

#### 1. Monte Carlo chart component

**File**: `src/components/forecast/MonteCarloChart.tsx` (new)

**Intent**: Render the simulation as a multi-series `LineChart`, copying the card chrome, axes, tooltip, and `ReferenceLine` wiring from `FireProjectionChart.tsx` and the mapped multi-`<Line>` render from `AssetTrendsChart.tsx`. Plot ~100 faint **sampled** paths (of the 1,000 computed) at low opacity plus bold P10/P50/P90 lines and a dashed `ReferenceLine` at the FIRE number. Build the single shared wide `data` array from the `MonteCarloResult`. Include the empty-state guard.

**Contract**: Build one row per year: `{ year, path0…pathK, p10, p50, p90 }` where K = sampled count (≤ 100). Sampled `<Line>`s: `strokeOpacity ~0.1–0.15`, `strokeWidth={1}`, `dot={false}`, `isAnimationActive={false}`, `legendType="none"`. Percentile `<Line>`s: full opacity, `strokeWidth ~2.5`, distinct `var(--chart-*)` colors, `dot={false}`, `isAnimationActive={false}`, with legend. `ReferenceLine y={fireNumber}` dashed (`strokeDasharray="3 3"`, label "FIRE number", `ifOverflow="extendDomain"`). `ResponsiveContainer width="100%" height={300} initialDimension={...} debounce={50}`. Numeric XAxis `dataKey="year" type="number" domain={["dataMin","dataMax"]}`. Currency YAxis formatter (reuse `FireProjectionChart`'s). Custom Tooltip reading only `p10/p50/p90` (a 100-series payload is useless). Empty-state guard returns a message card (Recharts refuses an empty dataset). **`log` the sampling cap** ("sampled 100 of 1,000") so truncation is visible, not silent.

#### 2. Wire the chart + help/disclaimer copy into the island

**File**: `src/components/forecast/ForecastView.tsx`

**Intent**: Render `MonteCarloChart` from the `computeMonteCarlo` result below the headline probability, and add the help/disclaimer section: what the simulation does, how to read the bands, the **volatility-drag** note (median reads below the entered return by ≈ σ²/2), the **left-tail-clamp** note (returns floored at −95%/yr, slightly optimistic), and the S-09 "estimate, not financial advice" disclaimer.

**Contract**: Pass the `paths` (sampled to ≤100), `bands`, and `fireNumber` to `MonteCarloChart`. Disclaimer/help copy as static prose near the chart, matching the S-09 disclaimer placement.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- The chart renders ~100 faint sampled paths + 3 bold percentile bands + the dashed FIRE-number reference line, with a visibly widening fan.
- No animation jank on first render or on input change; the chart re-renders smoothly when volatility changes.
- The empty-state guard shows a message (not a Recharts crash) when there's nothing to plot.
- The help copy explains the bands, the volatility-drag note, the clamp note, and the "estimate, not advice" disclaimer is present.
- The sampling cap is logged/visible ("sampled 100 of 1,000").

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation. Consider capturing the "seed-injected RNG as the testability seam for any stochastic module" lesson via `/10x-lesson`.

---

## Testing Strategy

### Unit Tests:

- `mulberry32` exact outputs for a known seed; range `[0,1)`.
- `nextGaussian` Box–Muller oracle for the first draw; sample mean/sd convergence over many draws.
- `percentile` type-7 interpolation table (p=0, 0.5, 1, and an interpolated rank).
- `computeMonteCarlo` exact `successProbability` and P50 terminal band against a fixed-seed oracle; band widening; SWR ≤ 0 `RangeError`; determinism; ×100/÷100 scaling probe.

### Integration Tests:

- None automated beyond the unit suite (the island is a thin adapter). The page is verified manually via the build + UI checks. An optional E2E (`/10x-e2e`) could assert the page loads, shows a headline %, and renders the chart — out of scope for this plan unless requested.

### Manual Testing Steps:

1. Sign in, set FIRE assumptions on `/dashboard/fire`, then open `/dashboard/forecast` — confirm it pre-fills.
2. Change volatility from 15% to 30% — confirm the fan widens and the probability drops.
3. Set volatility to 0% — confirm all paths collapse onto the deterministic projection (matches the FIRE page's single line).
4. Open the page with no FIRE prefs set — confirm defaults + the soft CTA to `/dashboard/fire`.
5. Check the Forecast nav item on both a desktop viewport and a mobile (`sm:hidden`) viewport.
6. Confirm the cross-link on the FIRE page navigates to Forecast.
7. Reload — confirm the result is identical for the same inputs (deterministic seed).

## Performance Considerations

- 1,000 paths × ~60 years ≈ 60k iterations is sub-ms — compute synchronously in the island; no Web Worker (research Area 9). Keep `computeMonteCarlo` pure so it can move off-thread later with zero call-site change.
- Render only ~100 sampled lines, not 1,000 — element count is the lever. `isAnimationActive={false}` (biggest win) and `dot={false}` (avoids ~6,000 SVG circles) on every `<Line>`. `ResponsiveContainer debounce={50}` so resize drags don't re-layout the heavy chart every pixel.
- Debounce volatility input changes if recompute-on-keystroke feels heavy (optional; measure first).

## Migration Notes

None — volatility is session-only for v1. No schema, `database.types.ts`, `PREFS_SELECT`, API, or `fire.astro` prefs changes. If volatility is promoted to persisted later, follow the S-14 6-touchpoint pattern (migration → `database.types.ts` Row/Insert/Update → `PREFS_SELECT` → API validation branch → `fire.astro` inline `.select` + `initialInputs` map → form seed+save).

## References

- Research: `context/changes/monte-carlo-simulation/research.md`
- Roadmap slice: `context/foundation/roadmap.md:327-345`
- FIRE engine reuse: `src/lib/fire.ts:51-53` (`toRealReturn`), `:81-86` (FIRE number + SWR guard), `:104` (recurrence)
- SSR template: `src/pages/dashboard/fire.astro:37-63`
- Island template: `src/components/fire/FireCalculatorForm.tsx:99-103` (guard-before-call), `:334-368` (`NumberField`)
- Chart templates: `src/components/fire/FireProjectionChart.tsx:1-94`, `src/components/AssetTrendsChart.tsx:137-144,222-233`
- Nav (both files): `src/components/Topbar.astro:34-39`, `src/components/TopbarMenu.tsx:3,64-69`
- Test conventions: `src/lib/fire.test.ts:5-13,16-28,180`; `vitest.config.ts:2,28,30-31`
- Lessons: `context/foundation/lessons.md:26-33` (Currency cast), `:35-43` (`vite-tsconfig-paths`), `:91-99` (nav in two files)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure Monte Carlo module + tests

#### Automated

- [x] 1.1 Type checking passes: `npx astro check`
- [x] 1.2 Unit tests pass: `npm run test`
- [x] 1.3 Linting passes: `npm run lint`

#### Manual

- [x] 1.4 A fixed seed produces byte-identical results across two runs
- [x] 1.5 The percentile bands visibly widen year-over-year for non-zero volatility

### Phase 2: Forecast page, island, nav & cross-link

#### Automated

- [ ] 2.1 Type checking passes: `npx astro check`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 2.4 "Forecast" appears in both desktop nav and mobile dropdown and routes correctly
- [ ] 2.5 Page pre-fills from persisted prefs; unset prefs show defaults + soft CTA
- [ ] 2.6 Editing volatility re-computes the headline probability; SWR ≤ 0 is guarded
- [ ] 2.7 FIRE page shows a working cross-link to Forecast
- [ ] 2.8 Headline probability is deterministic for a given input set

### Phase 3: Chart & presentation

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.4 Chart renders ~100 sampled paths + 3 percentile bands + FIRE-number reference line with a widening fan
- [ ] 3.5 No animation jank on render or input change
- [ ] 3.6 Empty-state guard shows a message, not a crash
- [ ] 3.7 Help copy covers bands, volatility-drag, clamp note, and "estimate, not advice" disclaimer
- [ ] 3.8 Sampling cap is logged/visible ("sampled 100 of 1,000")
