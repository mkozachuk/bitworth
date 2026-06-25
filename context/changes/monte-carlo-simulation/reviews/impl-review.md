<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Monte Carlo Simulation (S-16 "Forecast")

- **Plan**: context/changes/monte-carlo-simulation/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-06-25
- **Verdict**: NEEDS ATTENTION (both warnings low-blast-radius; all actionable findings fixed during triage)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria evidence: 16/16 Monte Carlo unit tests pass; `npm run lint` clean; `npm run build` succeeds; `npx astro check` adds zero new errors over the Phase-2 baseline (the 19 `'supabase' is possibly null` errors pre-exist across `.astro` files).

## Findings

### F1 — computeMonteCarlo runs unmemoized in the render body

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/components/forecast/ForecastView.tsx:131-134
- **Detail**: computeMonteCarlo (~70k Gaussian draws + 71 sorts of 1,000-element arrays at the default horizon) was called directly in the render body, re-running on every keystroke across all 8 NumberFields and on any unrelated re-render. The plan pre-acknowledged this as an optional concern and measured the compute as sub-ms; the compounding cost is the ~103-line Recharts reconcile riding each recompute.
- **Fix**: Wrapped in `useMemo(() => (swrValid ? computeMonteCarlo(toInputs(state, seed)) : null), [state, seed, swrValid])`.
  - Strength: Stops the draws + wide-row chart-data rebuild from re-running on every render; one-line, no behavior change.
  - Tradeoff: Minor — dep list must be correct; `[state, seed, swrValid]` is right (state identity changes per edit).
  - Confidence: HIGH — pure function, deterministic on (inputs, seed).
  - Blind spot: Doesn't stop the intentional Recharts re-render on real input changes.
- **Decision**: FIXED

### F2 — Sampled paths share var(--chart-2) with the P90 band

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/forecast/MonteCarloChart.tsx:138 vs :169
- **Detail**: Faint sampled-path lines used var(--chart-2) at opacity 0.12 — the same hue as the bold P90 band — so the P90 line blended into its own cloud of sampled paths. The plan asked for percentile lines in distinct colors.
- **Fix**: Changed the faint sampled-path stroke to `var(--muted-foreground)` so all three bands stay distinct against the sample cloud.
- **Decision**: FIXED

### F3 — console.info ships to the production browser console

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/forecast/MonteCarloChart.tsx:74-77
- **Detail**: The sampling-cap log (eslint-disabled for no-console) fired on every paths.length/totalPathCount change, in production. The plan required the log so truncation is visible; only the prod-noise aspect was the concern.
- **Fix**: Gated the `console.info` behind `import.meta.env.DEV`, preserving the plan's "visible truncation" intent without prod console noise.
- **Decision**: FIXED

### F4 — Silent error boundaries in forecast.astro (inherited)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/pages/dashboard/forecast.astro:21,23,39
- **Detail**: The assets/getRates/prefs reads destructure data and ignore error; a transient Supabase failure silently renders startingPrincipal=0 or default assumptions with no error surface. Byte-identical to the copied-from fire.astro:21,23,37 — a consistent pre-existing pattern, not a regression introduced by this change.
- **Fix**: None applied — consistent with fire.astro; cross-page hardening is out of scope for this change.
- **Decision**: SKIPPED
