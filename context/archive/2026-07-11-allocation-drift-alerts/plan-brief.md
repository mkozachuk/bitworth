# Allocation Drift Alerts — Plan Brief

> Full plan: `context/changes/allocation-drift-alerts/plan.md`

## What & Why

Roadmap slice **S-18**. When any of a user's balancer cards has a **real** allocation that has drifted past a ±5pp threshold from its **target**, the dashboard surfaces a drift-alert card naming the worst-drifting assets with a link to `/dashboard/balancer`. It is gated by a new `show_drift_alerts` user preference (on by default) — the explicit "enable/disable in settings" requirement.

## Starting Point

The allocation engine (`src/lib/allocation.ts`) already computes per-card real vs target allocation: `computeAllocation` returns per-slice `realPct` (normalized to 100, null-guarded near zero) and the card's `declaredSum`. The dashboard already gates the FIRE island on a boolean preference, and the balancer page already loads `allocation_cards` + `allocation_targets`. This plan composes those existing pieces — it adds one pure helper, one preference, and one card.

## Desired End State

A user with a drifted balancer card sees a dashboard card naming the single worst-drifting card and its top 2–3 offending assets with signed over/under drift (e.g. "BTC +8pp over target"), a note listing any other drifting cards, and — when a card's targets sum ≠100 — a note that comparison was done proportionally. The card is absent whenever the toggle is off, there are no cards/targets, or nothing currently breaches the threshold.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Drift metric | `realPct − normalizedTargetPct` (pp), card severity = max abs | Reuses `computeAllocation`'s normalized `realPct`; roadmap-specified | Roadmap |
| Threshold | Fixed `DRIFT_THRESHOLD_PCT = 5` constant (no preference) | v1 simplicity; promote to a pref later | Roadmap |
| Declared sum ≠100 | Normalize each card's targets to its `declaredSum` before differencing | `realPct` is on a 100 base; raw targets may not be | Roadmap |
| Settings gating | New `show_drift_alerts` boolean, mirror `show_fire_dashboard` 7-touchpoint chain | Proven precedent incl. the `backup.ts` whitelist | Roadmap + Research |
| Card scope | Show single worst card in detail; name other breaching cards in an "Also drifting" note | Compact + clear action without hiding that others drift | Plan |
| Offenders | Top 2–3 assets by abs drift, signed over/under | Actionable; mirrors FIRE card metric rows | Plan |
| No-drift state | Render nothing (absent) | It's an alert, not a persistent status widget | Plan |
| ≠100 note | Small inline "compared proportionally" note | Honest about normalization; roadmap-recommended | Plan |
| Testing | Mirror `allocation.test.ts` oracles, cover all risky edges | House style; pins normalization/null-denom/ranking | Plan |

## Scope

**In scope:** a `show_drift_alerts` preference (migration → types → API → settings UI → backup whitelist); a pure `computeDrift` helper + unit tests in `src/lib/allocation.ts`; a `DriftAlerts` dashboard island wired into `dashboard.astro`.

**Out of scope:** a configurable threshold preference; an "on target" status card; any change to `computeAllocation`/balancer/schema; a new nav item; rebalancing actions from the card; E2E tests.

## Architecture / Approach

`dashboard.astro` (SSR) reads the flag, loads cards/targets via the balancer page's load-and-reshape pattern, runs `computeDrift(cards, displayCurrency, rates)` over the already-loaded rates, and conditionally renders `<DriftAlerts client:load />`. `computeDrift` reuses `computeAllocation` per card, normalizes targets to `declaredSum`, differences against `realPct`, filters out degenerate (null-`realPct`/no-target) cards, and ranks the rest by severity. `DriftAlerts.tsx` is purely presentational, styled after `FireProgress.tsx`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Preference toggle | `show_drift_alerts` threaded through all 7 touchpoints | Forgetting the `backup.ts` whitelist (mapped) |
| 2. `computeDrift` engine | Pure, table-tested drift helper | Normalization / null-denom edge cases (pinned by tests) |
| 3. `DriftAlerts` island | Gated dashboard card consuming flag + engine | Empty/degenerate states must render nothing, not crash |

**Prerequisites:** S-14 (`show_fire_dashboard` precedent) and S-15 (`allocation_cards`/`allocation_targets` + `computeAllocation`) are both done. No blockers.
**Estimated effort:** ~1–2 sessions across 3 phases; each phase is small and independently verifiable.

## Open Risks & Assumptions

- Assumes `computeAllocation`'s per-card output (normalized `realPct`, `declaredSum`, null-guard) is stable — the plan builds directly on it.
- Declared-sum-≠-100 normalization is the main correctness trap; mitigated by dedicated oracle tests.
- Empty/no-card/near-zero-denominator states must render nothing rather than throw; mitigated by reusing the `realPct === null` guard and `EPSILON`, plus tests.

## Success Criteria (Summary)

- The settings toggle enables/disables the dashboard drift card and round-trips through backup export/import.
- A card drifted ≥5pp produces a dashboard alert naming the worst card and correct signed offenders, linking to the balancer; nothing shows when nothing drifts.
- `computeDrift` unit tests pass, covering normalization, null-denominator exclusion, thresholding, and multi-card ranking.
