import { EPSILON } from "@/lib/allocation";

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

// Signed drift rendered as "+8pp over target" / "−6pp under target". Rounded to
// whole pp to match the card's copy; the sign carries direction. The worst
// offender always breaches the threshold, so it never rounds to a bare "0pp".
function formatDrift(drift: number): string {
  const rounded = Math.round(drift);
  if (rounded > 0) return `+${rounded}pp over target`;
  if (rounded < 0) return `−${Math.abs(rounded)}pp under target`;
  return "on target";
}

export function DriftAlerts({ worstName, declaredSum, offenders, otherBreachingNames }: DriftAlertsProps) {
  const shownOffenders = offenders.slice(0, 3);
  const declaredSumOffTarget = Math.abs(declaredSum - 100) > EPSILON;

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/10">
      <p className="text-sm tracking-wider text-zinc-500 uppercase dark:text-white/50">Allocation drift</p>
      <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-white">{worstName}</p>

      <dl className="mt-4 space-y-3">
        {shownOffenders.map((offender) => (
          <div key={offender.asset_id} className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-zinc-600 dark:text-white/60">{offender.name}</dt>
            <dd className="text-right text-sm font-semibold whitespace-nowrap text-zinc-900 dark:text-white">
              {formatDrift(offender.drift)}
            </dd>
          </div>
        ))}
      </dl>

      {otherBreachingNames.length > 0 && (
        <p className="mt-4 text-xs text-zinc-500 dark:text-white/40">Also drifting: {otherBreachingNames.join(", ")}</p>
      )}

      {declaredSumOffTarget && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-white/40">
          Targets sum to {Math.round(declaredSum)}% — compared proportionally.
        </p>
      )}

      <a
        href="/dashboard/balancer"
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
      >
        Review in balancer
      </a>
    </div>
  );
}
