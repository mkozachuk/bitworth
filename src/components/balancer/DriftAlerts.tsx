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
        <div className="text-foreground/70 flex items-center gap-1.5 text-sm">
          <Arrow className="text-loss size-3.5" aria-hidden="true" />
          <span>{name}</span>
        </div>
        <span className="tnum text-foreground text-right text-sm font-semibold whitespace-nowrap">{label}</span>
      </div>

      <div
        className="bg-secondary relative h-3 w-full overflow-hidden rounded-sm"
        role="progressbar"
        aria-valuenow={Math.round(drift)}
        aria-valuemin={-DRIFT_SATURATION_PP}
        aria-valuemax={DRIFT_SATURATION_PP}
        aria-label={ariaLabel}
      >
        {/* Indigo severity fill, growing from center toward the drift's side.
            Direction and magnitude live in the arrow + "+35pp over target" text,
            so the fill stays quiet ink (The Seal Rule keeps vermilion small). */}
        <div
          className={cn(
            "bg-primary/70 absolute inset-y-0 transition-[width] duration-700 ease-out motion-reduce:transition-none",
            over ? "left-1/2 rounded-r-sm" : "right-1/2 rounded-l-sm",
          )}
          style={{ width: `${halfWidthPct}%` }}
        />
        {/* Center target marker: a vermilion threshold tick at 50%. */}
        <div className="bg-seal absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2" />
      </div>
    </div>
  );
}

export function DriftAlerts({ worstName, declaredSum, offenders, otherBreachingNames }: DriftAlertsProps) {
  const shownOffenders = offenders.slice(0, 3);
  const declaredSumOffTarget = Math.abs(declaredSum - 100) > EPSILON;

  return (
    <div className="bg-card border-border mt-6 rounded-md border p-6">
      <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Allocation drift</p>
      <p className="text-foreground mt-2 text-sm font-semibold">{worstName}</p>

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
        <p className="text-muted-foreground mt-5 text-xs">Also drifting: {otherBreachingNames.join(", ")}</p>
      )}

      {declaredSumOffTarget && (
        <p className="text-muted-foreground tnum mt-2 text-xs">
          Targets sum to {Math.round(declaredSum)}% — compared proportionally.
        </p>
      )}

      <a
        href="/dashboard/balancer"
        className="bg-primary text-primary-foreground hover:bg-primary/90 mt-5 inline-flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors"
      >
        Review in balancer
      </a>
    </div>
  );
}
