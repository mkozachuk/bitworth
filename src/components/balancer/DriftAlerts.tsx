import { ArrowUp, ArrowDown } from "lucide-react";

import { EPSILON } from "@/lib/allocation";
import { cn } from "@/lib/utils";

type Currency = "USD" | "EUR" | "PLN";

/** One offending asset within the worst-drifting card. Weights are on a 100 base (mirrors DriftAsset). */
export interface DriftOffender {
  asset_id: string;
  name: string;
  drift: number; // signed pp (positive = over target); realPct − normalizedTargetPct
  realPct: number; // current weight, normalized to a 100 base
  normalizedTargetPct: number; // target weight, normalized to a 100 base
}

export interface DriftAlertsProps {
  worstName: string;
  declaredSum: number; // sum of raw targetPct on the shown card; drives the ≠100 note
  offenders: DriftOffender[]; // already ordered largest-|drift| first by computeDrift
  otherBreachingNames: string[]; // other cards also breaching the threshold
  threshold: number; // DRIFT_THRESHOLD_PCT, echoed from computeDrift
  displayCurrency: Currency; // carried for currency-labelled context; pp needs none
}

// |drift| at or beyond this saturates the diverging bar to its full half-width
// (50% of the track, measured from the center marker). Chosen so common single-
// digit-to-teens drifts stay legible while a large drift (e.g. +37pp) can't push
// the fill past the rounded track edge — the clamp is load-bearing.
const DRIFT_SATURATION_PP = 20;

// Signed drift rendered as "+8pp over target" / "−6pp under target". Rounded to
// whole pp to match the card's copy; the sign carries direction. The worst
// offender always breaches the threshold, so it never rounds to a bare "0pp".
function formatDrift(drift: number): string {
  const rounded = Math.round(drift);
  if (rounded > 0) return `+${rounded}pp over target`;
  if (rounded < 0) return `−${Math.abs(rounded)}pp under target`;
  return "on target";
}

// One offender as a diverging target-bar row: name, a bar with a center target
// marker and an amber severity fill that grows from center toward the drift's
// side, a direction arrow, and a friendly current/target/gap label. Mirrors the
// FireProgress track/fill/a11y/reduced-motion idiom.
function DriftBar({ name, realPct, normalizedTargetPct, drift }: Omit<DriftOffender, "asset_id">) {
  const over = drift >= 0;
  // Unrounded geometry: |drift| maps to a fraction of the half-width, clamped so
  // the fill never escapes the rounded track. Half-width is 50% of the track.
  const halfWidthPct = Math.min(Math.abs(drift) / DRIFT_SATURATION_PP, 1) * 50;

  // Whole-number rounding for the friendly copy only.
  const nowPct = Math.round(realPct);
  const targetPct = Math.round(normalizedTargetPct);
  const label = `${nowPct}% now · ${targetPct}% target · ${formatDrift(drift)}`;
  const ariaLabel = `${name}: ${nowPct}% now versus ${targetPct}% target, ${formatDrift(drift)}`;

  const Arrow = over ? ArrowUp : ArrowDown;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-white/60">
          <Arrow className="size-3.5 text-amber-500 dark:text-amber-400" aria-hidden="true" />
          <span>{name}</span>
        </div>
        <span className="text-right text-sm font-semibold whitespace-nowrap text-zinc-900 dark:text-white">
          {label}
        </span>
      </div>

      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10"
        role="progressbar"
        aria-valuenow={Math.round(drift)}
        aria-valuemin={-DRIFT_SATURATION_PP}
        aria-valuemax={DRIFT_SATURATION_PP}
        aria-label={ariaLabel}
      >
        {/* Center target marker: a thin vertical rule at 50%. */}
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-400/70 dark:bg-white/30" />
        {/* Amber severity fill, growing from center toward the drift's side. */}
        <div
          className={cn(
            "absolute inset-y-0 bg-amber-500 transition-[width] duration-700 ease-out motion-reduce:transition-none dark:bg-amber-400",
            over ? "left-1/2 rounded-r-full" : "right-1/2 rounded-l-full",
          )}
          style={{ width: `${halfWidthPct}%` }}
        />
      </div>
    </div>
  );
}

export function DriftAlerts({ worstName, declaredSum, offenders, otherBreachingNames }: DriftAlertsProps) {
  const shownOffenders = offenders.slice(0, 3);
  const declaredSumOffTarget = Math.abs(declaredSum - 100) > EPSILON;

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/10">
      <p className="text-sm tracking-wider text-zinc-500 uppercase dark:text-white/50">Allocation drift</p>
      <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-white">{worstName}</p>

      <div className="mt-5 space-y-4">
        {shownOffenders.map((offender) => (
          <DriftBar
            key={offender.asset_id}
            name={offender.name}
            realPct={offender.realPct}
            normalizedTargetPct={offender.normalizedTargetPct}
            drift={offender.drift}
          />
        ))}
      </div>

      {otherBreachingNames.length > 0 && (
        <p className="mt-5 text-xs text-zinc-500 dark:text-white/40">Also drifting: {otherBreachingNames.join(", ")}</p>
      )}

      {declaredSumOffTarget && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-white/40">
          Targets sum to {Math.round(declaredSum)}% — compared proportionally.
        </p>
      )}

      <a
        href="/dashboard/balancer"
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
      >
        Review in balancer
      </a>
    </div>
  );
}
