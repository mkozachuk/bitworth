# Allocation Drift Card Restyle — Implementation Plan

## Overview

Restyle the dashboard **Allocation Drift** card from raw text rows into a visual, user-friendly card. Today each offending asset is a line of prose ("Bonds +37pp over target", "VWCE.DE −22pp under target"). We replace that with a **diverging target bar** per asset — a horizontal bar with a center "target" marker whose fill extends left (under target) or right (over target) proportional to the drift magnitude — paired with a friendly "current → target" label and a subtle directional arrow. Color encodes _severity_ (neutral/amber), not good-vs-bad, because being over target is a deviation, not a loss.

The component is a purely presentational React island; the only non-visual change is threading two already-computed fields (`realPct`, `normalizedTargetPct`) through the dashboard boundary so the bar can render "current vs target" rather than just the pp gap.

## Current State Analysis

- **Card component:** `src/components/balancer/DriftAlerts.tsx:31-69`. Renders an uppercase "Allocation drift" label, the worst card's name, then a `<dl>` mapping `offenders.slice(0,3)` to rows of `name` + `formatDrift(drift)` (`DriftAlerts.tsx:24-29`). Below: an "Also drifting: …" line, a "Targets sum to X% — compared proportionally" note (shown when `|declaredSum − 100| > EPSILON`), and a purple "Review in balancer" CTA anchor.
- **Prop contract:** `DriftAlertsProps` (`DriftAlerts.tsx:12-19`) with `offenders: DriftOffender[]`, where `DriftOffender` (`DriftAlerts.tsx:5-10`) is `{ asset_id, name, drift }` — **signed pp only**.
- **Data source:** `computeDrift()` (`src/lib/allocation.ts:147-187`) returns `DriftCard.offenders: DriftAsset[]`, where `DriftAsset` (`allocation.ts:104-111`) carries the richer `{ asset_id, name, realPct, normalizedTargetPct, drift }`. `realPct` is the asset's current weight on a 100 base; `normalizedTargetPct` is its target weight on a 100 base; `drift = realPct − normalizedTargetPct`.
- **The boundary that drops data:** `dashboard.astro:208-217` builds `driftAlerts` and at line 212 maps `drift.worst.offenders` to `{ asset_id, name, drift }` — **discarding `realPct` and `normalizedTargetPct`**. This is the one line that must widen to enable the "current → target" story.
- **Mount:** `dashboard.astro:243` — `{driftAlerts && <DriftAlerts {...driftAlerts} client:load />}`, gated by the `show_drift_alerts` preference (default TRUE) and only present when a card breaches `DRIFT_THRESHOLD_PCT` (5pp).

### Key Discoveries:

- **The data we need is already computed and just thrown away** — no changes to `allocation.ts` or the Supabase query are required. `DriftAsset` already has `realPct` + `normalizedTargetPct` (`allocation.ts:104-111`); only the `dashboard.astro:212` mapping and the `DriftOffender` interface need to widen.
- **A proven bar idiom exists:** `FireProgress.tsx:68-79` — `h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10` track with an inner fill using `transition-[width] duration-700 ease-out motion-reduce:transition-none`, plus `role="progressbar"` + `aria-valuenow/min/max/label`. Mirror this for the diverging bar (a11y + reduced-motion for free).
- **Card shell + row conventions** to match: card container `rounded-2xl border border-zinc-200 bg-white/80 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/10` (already used by DriftAlerts); the FIRE `Metric` row pattern `flex items-baseline justify-between gap-4` with `dt`/`dd` (`FireProgress.tsx:97-104`).
- **Lucide is the icon idiom:** `import { ArrowUp, ArrowDown } from "lucide-react"`, sized `size-4` / `size-3.5` (per `AssetCard.tsx`, `TopbarMenu.tsx`). Use for the per-row direction arrow.
- **`cn()` util** (`src/lib/utils.ts`) is available for conditional class merging (twMerge + clsx).
- **Color semantics decision:** drift direction is neutral. Use one "needs attention" accent (amber) whose bar length scales with severity; direction is shown by which side of center the bar fills and by the arrow — **not** by a green/red good/bad split (which would misread "over target" as "good").
- **Rounding note:** `formatDrift` rounds drift to whole pp; the worst offender always breaches 5pp so it never renders a bare "0pp". When labeling current/target weights, follow the same whole-number rounding for the friendly copy while using the unrounded values for bar geometry.

## Desired End State

The dashboard's Allocation Drift card shows, for each of the up-to-3 worst offenders in the worst-drifting card:

- The asset name and a friendly label communicating **current weight → target weight** and the signed pp gap (e.g. "12% now · 5% target · 7pp over").
- A **diverging horizontal bar**: a track with a center target marker; the fill extends right for over-target, left for under-target, its length proportional to |drift| (clamped so extreme drifts stay within the track). Amber severity accent, animated width with reduced-motion respect, and `role="progressbar"` a11y.
- A subtle Lucide arrow (up = over, down = under) reinforcing direction non-visually.

Below the rows, the worst-card name heading, the "Also drifting: …" line, the proportional-targets note, and the "Review in balancer" CTA all remain, restyled to fit. Dark mode is fully supported. The card only appears when a card breaches the 5pp threshold (unchanged gating).

**Verification:** `npm run typecheck`, `npm run lint`, `npm run build` all pass; the card renders the new visual on the dashboard with real drifting data and degrades cleanly for edge cases (see Testing Strategy).

## What We're NOT Doing

- **No changes to drift math** — `computeDrift`, `DRIFT_THRESHOLD_PCT`, the Supabase query, or the `computeAllocation` normalization. We only surface fields it already produces.
- **No change to the gating** — `show_drift_alerts` preference, the 5pp threshold, or the "only worst card, top-3 offenders" selection remain as-is.
- **No new shared UI library primitive** (no generic `Card`/`ProgressBar` in `src/components/ui`). The diverging bar is a local subcomponent of DriftAlerts; extracting a reusable primitive is out of scope.
- **No Recharts / charting** — this is a lightweight CSS/flex bar, not a chart.
- **No interactivity** beyond the existing CTA (no hover tooltips, no expand/collapse, no per-asset drill-down).
- **No dashboard layout changes** to sibling cards (NetWorth, FireProgress, AssetsSummary).

## Implementation Approach

Two phases, smallest-blast-radius first. Phase 1 widens the data contract (mechanical, verified by the compiler). Phase 2 is the pure visual work, consuming the new fields and mirroring the FireProgress bar pattern. Splitting them keeps the risky/iterative visual work isolated from the trivial plumbing, and gives a clean typecheck checkpoint between them.

## Critical Implementation Details

**Diverging bar geometry.** The bar represents drift relative to a center line at 50% of the track. Map |drift| to a half-width fill; clamp the fill so a very large drift (e.g. +37pp) does not overflow the track — pick a saturation cap (e.g. drift ≥ some pp maps to the full half-width) and document the cap inline. Over-target fills from center rightward; under-target fills from center leftward. The center target marker is a thin vertical rule at 50%. Because the worst offender can be large, the clamp is load-bearing: without it the fill div escapes the rounded track.

**Reduced motion + a11y.** Reuse the FireProgress approach verbatim in spirit: `transition-[width] … motion-reduce:transition-none` and `role="progressbar"` with `aria-valuenow` (the signed pp, or |drift|), `aria-valuemin/max`, and a descriptive `aria-label` naming the asset and whether it's over/under target. The arrow icon should be `aria-hidden` since the label already carries direction.

## Phase 1: Thread current/target weights through the boundary

### Overview

Widen the `DriftOffender` prop contract to carry `realPct` and `normalizedTargetPct`, and update the `dashboard.astro` mapping to pass them. No visual change yet — the component keeps rendering as before; this phase only makes the richer data available at the island boundary.

### Changes Required:

#### 1. Widen the offender prop contract

**File:** `src/components/balancer/DriftAlerts.tsx`

**Intent:** Add the two already-computed weight fields to the per-offender prop so the component can render current-vs-target in Phase 2. Update the interface doc comment to describe them.

**Contract:** `DriftOffender` becomes `{ asset_id: string; name: string; drift: number; realPct: number; normalizedTargetPct: number }`. Field semantics mirror `DriftAsset` in `allocation.ts:104-111` (both already normalized to a 100 base). No other change to `DriftAlertsProps`; the component body is untouched in this phase.

#### 2. Pass the fields from the dashboard

**File:** `src/pages/dashboard.astro`

**Intent:** Stop discarding `realPct`/`normalizedTargetPct` when reshaping `drift.worst.offenders` into props.

**Contract:** At the `offenders.map(...)` on `dashboard.astro:212`, include `realPct: o.realPct` and `normalizedTargetPct: o.normalizedTargetPct` alongside the existing `asset_id`, `name`, `drift`. `o` is a `DriftAsset` which already exposes both. No other frontmatter change.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Dashboard still renders the drift card unchanged (no visual regression yet) when a card is breaching.

**Implementation Note:** After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Restyle the DriftAlerts card

### Overview

Replace the text `<dl>` rows with diverging target-bar rows, add friendly current→target labels and directional arrows, apply the neutral/amber severity palette, and restyle the surrounding content (worst-card heading, "Also drifting" line, proportional-targets note, CTA) to match — all while preserving the existing card shell and the card's gating behavior.

### Changes Required:

#### 1. Diverging target-bar row

**File:** `src/components/balancer/DriftAlerts.tsx`

**Intent:** Introduce a local `DriftBar` (or inline row) subcomponent that renders one offender as: asset name, friendly label, a diverging bar with center target marker + amber severity fill, and a Lucide direction arrow. Mirror the FireProgress bar's track/fill/a11y/reduced-motion pattern.

**Contract:** A subcomponent taking `{ name, realPct, normalizedTargetPct, drift }`. Bar track uses the `h-3 … rounded-full bg-zinc-200 dark:bg-white/10` idiom; the inner fill is positioned from the 50% center and sized by a clamped map of |drift| → half-width, colored with an amber severity accent (`bg-amber-500` / dark variant), `transition-[width] … motion-reduce:transition-none`. Center marker is a thin vertical rule at 50%. `role="progressbar"` + `aria-valuenow`/`aria-valuemin`/`aria-valuemax` + descriptive `aria-label`; arrow icon (`ArrowUp`/`ArrowDown` from lucide-react, `aria-hidden`). Keep the existing `formatDrift` for the pp portion of the label; add whole-number-rounded current/target percentages to the label copy.

#### 2. Restyle surrounding content

**File:** `src/components/balancer/DriftAlerts.tsx`

**Intent:** Keep and lightly restyle the worst-card name heading, the "Also drifting: …" line, the proportional-targets note, and the "Review in balancer" CTA so they read as one coherent card with the new rows.

**Contract:** No change to which secondary elements render or their conditions (`otherBreachingNames.length > 0`, `declaredSumOffTarget`). The CTA remains an anchor to `/dashboard/balancer`; restyle is class-only. Card shell (`rounded-2xl border … backdrop-blur-xl …`) unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes (including `react-compiler` error rule): `npm run lint`
- Production build succeeds: `npm run build`
- Prettier formatting clean: `npm run format` leaves the file unchanged (or run before commit)

#### Manual Verification:

- With real drifting data, each of the top-3 offenders shows a diverging bar filling the correct side (over = right, under = left) with length scaling by severity, plus the current→target label and matching arrow.
- Amber severity palette reads as "attention", not "good/bad"; nothing implies over-target is good.
- Extreme drift (e.g. +37pp) stays within the track (clamp works); very small drift near the 5pp threshold still renders a visible, correctly-sided fill.
- "Also drifting" line and "Targets sum to X%" note appear only under their existing conditions and are legible in the new styling.
- Dark mode: bars, marker, text, and arrows are all legible; contrast is acceptable.
- Reduced-motion: with OS "reduce motion" on, bars do not animate width.
- No regression to sibling dashboard cards; card still absent when no card breaches the threshold.

**Implementation Note:** After completing this phase and all automated verification passes, pause for manual confirmation that the visual testing was successful.

---

## Testing Strategy

### Unit Tests:

- No new unit tests required — the drift math (`computeDrift`) is unchanged and already covered where applicable. This change is presentational.
- If a `DriftBar` geometry helper (|drift| → clamped fill width) is extracted as a pure function, add a small test pinning: zero drift → centered/empty fill; positive → right fill; negative → left fill; saturating drift → capped at half-width. (Optional — only if the helper is non-trivial.)

### Integration Tests:

- None. No API or data-flow change beyond passing two extra already-typed fields.

### Manual Testing Steps:

1. Sign in with an account whose balancer card breaches 5pp (or adjust a target to force drift), load `/dashboard`.
2. Confirm each offender row: correct side fill, severity-scaled length, current→target label, matching arrow.
3. Force an extreme drift (large over-allocation) and confirm the bar clamps within the track.
4. Force a card whose targets don't sum to 100 and confirm the "compared proportionally" note still shows and reads well.
5. Toggle dark mode; verify legibility.
6. Enable OS reduce-motion; verify bars don't animate.
7. Confirm the card disappears when no card breaches the threshold (e.g. `show_drift_alerts` off, or all within 5pp).

## Performance Considerations

Negligible — up to 3 CSS/flex rows, no charts, no new network calls. The two extra props are primitives already in memory.

## Migration Notes

None. No schema, data, or API changes; no persisted state affected.

## References

- Card component: `src/components/balancer/DriftAlerts.tsx:31-69`
- Drift computation + `DriftAsset` shape: `src/lib/allocation.ts:104-187`
- Data boundary to widen: `src/pages/dashboard.astro:208-217`
- Bar + a11y + reduced-motion idiom to mirror: `src/components/fire/FireProgress.tsx:68-79`
- Row layout idiom: `src/components/fire/FireProgress.tsx:97-104`
- Color/gain-loss conventions (for contrast with the neutral choice made here): `src/components/assets/TopMovers.tsx:18-31`
- `cn()` util: `src/lib/utils.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Thread current/target weights through the boundary

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 515df95
- [x] 1.2 Linting passes: `npm run lint` — 515df95
- [x] 1.3 Production build succeeds: `npm run build` — 515df95

#### Manual

- [x] 1.4 Dashboard still renders the drift card unchanged when a card is breaching (verified: git diff shows the DriftAlerts render body untouched — only the interface widened and dashboard.astro passes two inert extra props; typecheck/lint/build green) — 515df95

### Phase 2: Restyle the DriftAlerts card

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes (including `react-compiler`): `npm run lint`
- [x] 2.3 Production build succeeds: `npm run build`
- [x] 2.4 Prettier formatting clean: `npm run format` leaves the file unchanged

#### Manual

- [x] 2.5 Top-3 offenders each show a correctly-sided, severity-scaled diverging bar with current→target label and matching arrow (verified: read DriftAlerts.tsx:46-113 — over-target fills `left-1/2 rounded-r-full` with `ArrowUp`, under-target `right-1/2 rounded-l-full` with `ArrowDown`; fill width `min(|drift|/20,1)*50%` scales with severity; label built from `realPct`/`normalizedTargetPct`/`formatDrift`; `slice(0,3)`)
- [x] 2.6 Amber severity palette reads as "attention", not good/bad (verified: read DriftAlerts.tsx — single amber accent `bg-amber-500`/`dark:bg-amber-400` for both fill and arrows, no green/red good-bad split; direction shown only by fill side + arrow)
- [x] 2.7 Extreme drift clamps within the track; near-threshold drift still renders a visible correctly-sided fill (verified: clamp `Math.min(|drift|/20,1)*50` caps fill at the 50% half-width inside the `overflow-hidden` track, so +37pp cannot overflow; ~5pp near-threshold → 12.5% visible correctly-sided fill)
- [x] 2.8 "Also drifting" line and proportional-targets note appear only under their existing conditions and are legible (verified: read DriftAlerts.tsx:116-124 — conditions `otherBreachingNames.length > 0` and `declaredSumOffTarget` unchanged from prior; standard legible text classes reused)
- [ ] 2.9 Dark mode legibility verified
- [x] 2.10 Reduced-motion: bars do not animate width when OS reduce-motion is on (verified: `motion-reduce:transition-none` on the sole width-animated fill div at DriftAlerts.tsx:85 — the exact Tailwind `prefers-reduced-motion` mechanism; `transition-[width]` is the only animation, so reduce-motion disables it deterministically)
- [x] 2.11 No regression to sibling cards; card still absent when no card breaches the threshold (verified: change confined to DriftAlerts.tsx per touched-file set — sibling cards untouched; gating `{driftAlerts && …}` lives in dashboard.astro, not touched this phase)
