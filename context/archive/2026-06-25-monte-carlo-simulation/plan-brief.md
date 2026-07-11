# Monte Carlo Simulation (S-16 "Forecast") — Plan Brief

> Full plan: `context/changes/monte-carlo-simulation/plan.md`
> Research: `context/changes/monte-carlo-simulation/research.md`

## What & Why

Add a Monte Carlo "Forecast" page that runs 1,000 randomized market paths over the user's FIRE horizon and reports the **probability of reaching their FIRE goal** as a single headline percentage, plus a chart of sampled paths and P10/P50/P90 bands. It's the probabilistic companion to the deterministic S-09 FIRE projection — a probability communicates risk that a single line can't.

## Starting Point

The S-09 FIRE engine (`src/lib/fire.ts`) already runs entirely in real terms, derives the FIRE number, and persists `fire_*` prefs that `dashboard/fire.astro` SSR-loads into a React island. Recharts conventions exist (`FireProjectionChart`, `AssetTrendsChart`), as does a pure-module + fixed-seed test discipline. What's missing: any RNG, Gaussian, or percentile helper — all greenfield.

## Desired End State

A signed-in user opens a new "Forecast" nav item, lands on `/dashboard/forecast` pre-filled with their FIRE assumptions plus one new volatility input, and sees a headline "X% of 1,000 paths reach your FIRE number," a fan chart (sampled paths + percentile bands + a FIRE-number reference line), and plain-language help with an "estimate, not financial advice" disclaimer. The FIRE page links across to it.

## Key Decisions Made

| Decision                  | Choice                                              | Why (1 sentence)                                                              | Source   |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Return model              | Parametric Normal, real terms                       | No bundled dataset; keeps the single real-terms convention from S-09          | Research |
| Volatility-drag handling  | Arithmetic mean + disclose −σ²/2 drag               | Matches the S-09 input's meaning so both views agree; one disclaimer line     | Plan     |
| Success metric            | Terminal-wealth only (balance ≥ FIRE # at horizon)  | Correct for an accumulation calculator; "at-or-before" over-counts            | Plan     |
| Volatility persistence    | Session-only (no migration)                         | Keeps the slice to one module + page + island; promote to a column later      | Plan     |
| Volatility input          | Pct field, default 15%, clamp 0–60%                 | Mirrors the other rate fields + NumberField precedent; 15% suits equities     | Plan     |
| Path counts               | 1,000 computed / 100 sampled                        | Stable percentiles, readable chart, sub-ms compute                            | Plan     |
| Quantile method           | Type-7 linear interpolation                         | Smooth bands; pick one and stay consistent                                    | Research |
| Route / label / icon      | `/dashboard/forecast`, "Forecast", Lucide `Dices`   | Plain-language, pairs with FIRE; Dices conveys randomization                  | Plan     |
| First-visit (no prefs)    | Degrade to defaults + soft CTA to FIRE              | Page always runs and is explorable; nudges consistency without blocking       | Plan     |

## Scope

**In scope:** pure `src/lib/monte-carlo.ts` (mulberry32, Box–Muller, type-7 percentile, clamped real-terms recurrence, terminal-wealth success) + tests; `dashboard/forecast.astro`; `ForecastView` island with volatility input; `MonteCarloChart`; "Forecast" nav in both nav files; FIRE-page cross-link; help/disclaimer copy.

**Out of scope:** persisted volatility column / migration; Web Worker; log-normal draws; bootstrap/historical return model; decumulation (Trinity) metric; median years-to-FI; new charting library.

## Architecture / Approach

A thin additive read-and-compute layer. A pure, **seed-injected** `monte-carlo.ts` reuses `fire.ts`'s `toRealReturn` + FIRE-number derivation, draws each year's real return from `Normal(realReturn, σ)`, clamps the growth multiplier at `max(0.05, 1+r)`, and returns the path matrix + per-year percentile bands + terminal success %. The `forecast.astro` page copies the `fire.astro` SSR prefs load; the `ForecastView` island guards before calling the throwing module and feeds `MonteCarloChart` (Recharts, animation/dots off, 100 sampled lines + 3 bold bands + FIRE-number reference line).

## Phases at a Glance

| Phase                              | What it delivers                                              | Key risk                                                        |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 1. Pure module + tests             | `monte-carlo.ts` + fixed-seed unit suite                     | Subtle math (volatility drag, real-terms, clamp, percentiles)  |
| 2. Page, island, nav, cross-link   | Reachable page rendering the headline probability            | SSR prefs mapping; guard-before-call; nav in both files        |
| 3. Chart & presentation            | Multi-series fan chart + help/disclaimer copy                | Recharts render perf (100 series); empty-state guard           |

**Prerequisites:** S-09 shipped (`fire.ts`, `fire.astro`, `fire_*` prefs); Recharts + Vitest already configured.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Volatility drag makes the median band read below the entered return — correct, but must be clearly explained or it reads as a bug.
- The left-tail clamp (−95%/yr floor) introduces a slight optimistic bias — disclosed in copy.
- Session-only volatility resets each visit — accepted for v1.
- 1,000 paths is enough for a headline % but not ultra-stable deep tails — accepted.

## Success Criteria (Summary)

- User sees a deterministic-for-given-inputs probability and a readable fan chart pre-filled from their FIRE assumptions.
- Volatility = 0% collapses all paths onto the deterministic FIRE projection (cross-view consistency check).
- "Forecast" is reachable on both desktop and mobile; the FIRE page cross-links to it; the fixed-seed test suite passes.
