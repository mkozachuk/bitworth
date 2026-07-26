import type { ReactNode } from "react";

import type { GoalEta } from "@/lib/goals";
import type { Currency } from "@/lib/net-worth";

// Purely presentational, exactly like FireProgress: zero state, zero effects,
// zero fetching. Every number below is computed server-side in dashboard.astro
// (goals.ts does the math once, sharing a single trajectory fit across goals),
// so this island is a plain function of its props.

/** One goal, already reduced to display-currency numbers and an ETA decision. */
export interface GoalProgressItem {
  id: string;
  name: string;
  /** UNCAPPED 0–100-scale progress. Optional so the defensive clamp below is real. */
  percent?: number;
  /** Current value of the measured pool, in the display currency. */
  current: number;
  /** Target, already converted into the display currency. */
  target: number;
  /** The four-state ETA decision from `goalEta`. */
  eta: GoalEta;
  /** `onTrackVerdict` against the goal's target date; `null` when there is nothing to compare. */
  verdict: "on_track" | "behind" | null;
}

/** Exported so dashboard.astro imports this shape rather than redeclaring it (as DriftAlerts does). */
export interface GoalsProgressProps {
  goals: GoalProgressItem[];
  displayCurrency: Currency;
}

/** How many goals the card shows before collapsing the rest into a "+N more" line. */
const MAX_SHOWN = 3;

// View-edge formatters, kept local and duplicated on purpose — this repo has no
// shared formatter module and deliberately does not want one.
function formatAmount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPercent(percent: number): string {
  return `${percent.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function formatDate(iso: string): string {
  // Render in UTC, the same calendar frame `onTrackVerdict` compares the ETA and
  // target_date in — otherwise a viewer hours off UTC could see a completion date
  // one day off from the day that drove the on-track/behind badge.
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function GoalsProgress({ goals, displayCurrency }: GoalsProgressProps) {
  if (goals.length === 0) {
    return (
      <div className="border-kraft mt-6 rounded-md border-2 border-dashed p-6">
        <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Savings goals</p>
        <p className="text-foreground/70 mt-2 text-sm">
          Name a target — total net worth or a single asset category — to track your progress toward it here.
        </p>
        <a
          href="/dashboard/goals"
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 inline-flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors"
        >
          Create your first goal
        </a>
      </div>
    );
  }

  // Descending by progress. Copy first — never sort the props array in place.
  const ranked = [...goals].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  const shown = ranked.slice(0, MAX_SHOWN);
  const remainder = ranked.length - shown.length;

  return (
    <div className="bg-card border-border mt-6 rounded-md border p-6">
      <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Savings goals</p>

      <div className="mt-4 space-y-6">
        {shown.map((goal) => (
          <GoalRow key={goal.id} goal={goal} displayCurrency={displayCurrency} />
        ))}
      </div>

      {remainder > 0 && (
        <a
          href="/dashboard/goals"
          className="text-primary dark:text-foreground mt-5 inline-block text-xs transition-colors hover:underline"
        >
          +{remainder} more {remainder === 1 ? "goal" : "goals"}
        </a>
      )}

      <p className="text-muted-foreground mt-4 text-xs">
        An <strong>estimate, not financial advice</strong>, shown in {displayCurrency}.
      </p>
    </div>
  );
}

function GoalRow({ goal, displayCurrency }: { goal: GoalProgressItem; displayCurrency: Currency }) {
  // Defensive: goalProgressPct already guards a near-zero target at the source,
  // but clamp again here so a stray Infinity/NaN can never leak into the width,
  // the label, or aria-valuenow. Per goal, not hoisted — this is the view edge.
  const rawPct = goal.percent ?? 0;
  const pct = Number.isFinite(rawPct) ? Math.max(0, rawPct) : 0;
  const fillWidth = Math.min(pct, 100);
  const reached = pct >= 100;
  const note = etaNote(goal.eta);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-foreground/70 text-sm">{goal.name}</p>
        <p className={`tnum text-sm font-semibold ${reached ? "text-gain" : "text-foreground"}`}>
          {formatPercent(pct)}
        </p>
      </div>

      <div className="bg-secondary mt-2 h-3 w-full overflow-hidden rounded-sm">
        <div
          className="bg-primary h-full rounded-sm transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${fillWidth}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progress toward ${goal.name}`}
        />
      </div>

      <dl className="mt-3 space-y-3">
        <Metric
          label="Saved"
          value={`${formatAmount(goal.current)} of ${formatAmount(goal.target)} ${displayCurrency}`}
        />
        {/* `unsupported` (a category goal in v1) hides the row entirely rather
            than rendering an "N/A" — the rule FireProgress follows for its own
            absent metrics. */}
        {goal.eta.status === "projected" && (
          <Metric
            label="Est. completion"
            value={
              <span className="inline-flex items-center gap-2">
                {formatDate(goal.eta.date)}
                {goal.verdict !== null && <Badge verdict={goal.verdict} />}
              </span>
            }
          />
        )}
        {goal.eta.status === "reached" && <Metric label="Status" value={<span className="text-gain">Reached</span>} />}
      </dl>

      {/* The two "no date" explanations are prose, not metrics, so they live
          outside the <dl> — a bare <p> is not valid description-list content. */}
      {note !== null && <p className="text-muted-foreground mt-3 text-xs">{note}</p>}
    </div>
  );
}

// The two ETA states that explain themselves in a sentence instead of a date.
// `not_reaching` reuses the shipped trajectory copy verbatim; the two must never
// be conflated — "we cannot say yet" is not "you never will".
function etaNote(eta: GoalEta): string | null {
  if (eta.status === "not_reaching") return "On your current trend, you won't reach this.";
  if (eta.status === "insufficient_history") return "Not enough snapshot history in this currency to project a date.";
  return null;
}

function Badge({ verdict }: { verdict: "on_track" | "behind" }) {
  const onTrack = verdict === "on_track";
  return (
    <span
      className={`rounded-sm border px-2 py-0.5 text-xs font-medium ${
        onTrack ? "border-gain-soft text-gain bg-transparent" : "bg-kraft/40 border-kraft text-foreground/80"
      }`}
    >
      {onTrack ? "On track" : "Behind"}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-foreground/70 text-sm">{label}</dt>
      <dd className="tnum text-foreground text-right text-sm font-semibold whitespace-nowrap">{value}</dd>
    </div>
  );
}
