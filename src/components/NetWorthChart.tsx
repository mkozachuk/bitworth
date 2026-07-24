import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { Tables } from "@/lib/database.types";
import {
  fitLinear,
  fitCagr,
  valueAt,
  projectForward,
  etaToTarget,
  type Fit,
  type FitModel,
  type TrajectorySample,
} from "@/lib/trajectory";

type SnapshotRow = Tables<"snapshots">;
type Currency = "USD" | "EUR" | "PLN";

const VALID_CURRENCIES: Currency[] = ["USD", "EUR", "PLN"];

const MS_PER_DAY = 86_400_000;
const MAX_HORIZON_DAYS = 5 * 365;
/** Point count handed to `projectForward` (index 0 lands on the last historical point). */
const PROJECTION_STEPS = 13;

interface SnapshotPoint {
  date: string;
  netWorth: number | null;
  displayCurrency: Currency;
  projected?: number | null;
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

interface Props {
  snapshots: SnapshotRow[];
  displayCurrency: Currency;
  showTrajectory?: boolean;
  onSaveSnapshot?: () => void;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number | null; dataKey?: string | number; payload: SnapshotPoint }[];
  label?: string;
}) {
  if (active && payload?.length) {
    const entry = payload.find((p) => typeof p.value === "number") ?? null;
    if (!entry || typeof entry.value !== "number") return null;
    const formattedDate = label ? formatDate(label) : label;
    const point = entry.payload;
    const isProjected = entry.dataKey === "projected" && point.netWorth === null;
    return (
      <div className="rounded-lg border border-zinc-200 bg-white/95 p-3 text-zinc-900 backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white">
        <p className="text-xs text-zinc-600 dark:text-white/60">
          {formattedDate}
          {isProjected ? " (projected)" : ""}
        </p>
        <p className="text-sm font-semibold">
          {formatMoney(entry.value)} {point.displayCurrency}
        </p>
      </div>
    );
  }
  return null;
}

export function NetWorthChart({ snapshots, displayCurrency, showTrajectory = false, onSaveSnapshot }: Props) {
  const [model, setModel] = useState<FitModel>("linear");
  const [target, setTarget] = useState("");

  const chartData: SnapshotPoint[] = snapshots.map((s) => {
    const raw = s.display_currency;
    const pointCurrency: Currency = VALID_CURRENCIES.includes(raw as Currency) ? (raw as Currency) : "USD";
    return {
      date: s.created_at,
      netWorth: s.total_net_worth,
      displayCurrency: pointCurrency,
    };
  });

  const currenciesUsed = new Set(chartData.map((p) => p.displayCurrency));
  const isMixed = currenciesUsed.size > 1;
  const sortedCurrencies = Array.from(currenciesUsed).sort();
  const changeDate = isMixed
    ? (() => {
        for (let i = 1; i < chartData.length; i++) {
          if (chartData[i].displayCurrency !== chartData[i - 1].displayCurrency) {
            return chartData[i].date;
          }
        }
        return null;
      })()
    : null;

  // Find Jan 1st net worth for reference line
  const yearStart = new Date(`${new Date().getFullYear()}-01-01T00:00:00Z`);
  const janSnap = snapshots.find((s) => new Date(s.created_at) <= yearStart);
  const janNetWorth = janSnap ? janSnap.total_net_worth : null;

  if (snapshots.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-8 text-center dark:border-white/10 dark:bg-white/5">
        <p className="mb-4 text-sm text-zinc-600 dark:text-white/60">
          No snapshots yet. Save your first one to see your trend.
        </p>
        <button
          onClick={() => onSaveSnapshot?.()}
          className="rounded-lg bg-purple-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
        >
          Save your first snapshot
        </button>
      </div>
    );
  }

  const changeDateFormatted = changeDate ? formatDate(changeDate) : null;

  // --- Trajectory projection -------------------------------------------------
  // Fit only over the comparable (same-currency) snapshots; never across a
  // currency change. Time axis is DAYS SINCE THE FIRST comparable snapshot.
  const comparable = snapshots.filter((s) => s.display_currency === displayCurrency);
  const originMs = comparable.length > 0 ? new Date(comparable[0].created_at).getTime() : 0;
  const samples: TrajectorySample[] = comparable.map((s) => ({
    t: (new Date(s.created_at).getTime() - originMs) / MS_PER_DAY,
    value: s.total_net_worth,
  }));

  const hasEnoughHistory = samples.length >= 2;
  const linearFit = hasEnoughHistory ? fitLinear(samples) : null;
  const cagrFit = hasEnoughHistory ? fitCagr(samples) : null;
  const activeFit: Fit | null = model === "cagr" ? cagrFit : linearFit;

  const firstT = samples.length > 0 ? samples[0].t : 0;
  const lastT = samples.length > 0 ? samples[samples.length - 1].t : 0;
  const horizonDays = Math.min(lastT - firstT, MAX_HORIZON_DAYS);
  const endT = lastT + horizonDays;

  const projectionOn = showTrajectory && activeFit !== null && horizonDays > 0;

  const renderData: SnapshotPoint[] = chartData;
  let paceValue: number | null = null;
  let paceDate: string | null = null;

  if (projectionOn) {
    const forward = projectForward(activeFit, lastT, endT, PROJECTION_STEPS);
    const lastComparableDate = comparable[comparable.length - 1].created_at;
    const lastHistoricalIndex = renderData.findIndex((p) => p.date === lastComparableDate);
    if (lastHistoricalIndex !== -1) {
      // Seed `projected` on the final historical point so the dotted line joins
      // the solid one with no gap.
      renderData[lastHistoricalIndex] = {
        ...renderData[lastHistoricalIndex],
        projected: renderData[lastHistoricalIndex].netWorth,
      };
    }
    // Skip index 0 — it lands on lastT, already covered by the seeded point.
    for (let i = 1; i < forward.length; i++) {
      renderData.push({
        date: new Date(originMs + forward[i].t * MS_PER_DAY).toISOString(),
        netWorth: null,
        displayCurrency,
        projected: forward[i].value,
      });
    }
    paceValue = valueAt(activeFit, endT);
    paceDate = new Date(originMs + endT * MS_PER_DAY).toISOString();
  }

  const targetValue = target.trim() === "" ? null : Number(target);
  const hasTarget = targetValue !== null && Number.isFinite(targetValue);
  const etaT = projectionOn && hasTarget ? etaToTarget(activeFit, targetValue, lastT) : null;
  const etaDate = etaT !== null ? new Date(originMs + etaT * MS_PER_DAY).toISOString() : null;

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 dark:border-white/10 dark:bg-white/5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-wider text-zinc-600 uppercase dark:text-white/60">
          Net Worth Trend
        </h2>
        <span className="text-xs text-zinc-500 dark:text-white/40">{displayCurrency}</span>
      </div>

      {isMixed && changeDateFormatted && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Your chart mixes {sortedCurrencies.join(" and ")} snapshots from before/after your currency change on{" "}
          {changeDateFormatted}.
        </div>
      )}

      <ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}>
        <LineChart data={renderData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="5 5" />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-US", { month: "short" })}
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v: number) =>
              v.toLocaleString("en-US", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })
            }
          />
          <Tooltip content={<CustomTooltip />} />
          <Line type="monotone" dataKey="netWorth" stroke="var(--chart-1)" dot={false} strokeWidth={2} />
          {projectionOn && (
            <Line
              type="monotone"
              dataKey="projected"
              stroke="var(--chart-1)"
              strokeDasharray="6 4"
              strokeOpacity={0.6}
              dot={false}
              connectNulls
            />
          )}
          {janNetWorth !== null && (
            <ReferenceLine
              y={janNetWorth}
              stroke="var(--chart-2)"
              strokeDasharray="3 3"
              label={{
                value: "Start",
                fill: "var(--chart-2)",
                position: "insideTopRight",
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {showTrajectory && !hasEnoughHistory && (
        <p className="mt-4 text-xs text-zinc-500 dark:text-white/40">
          Not enough history yet — save more snapshots to see a projection.
        </p>
      )}

      {projectionOn && (
        <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium tracking-wider text-zinc-600 uppercase dark:text-white/60">
              Projection
            </span>
            <div
              role="group"
              aria-label="Projection model"
              className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-white/10"
            >
              <button
                type="button"
                aria-pressed={model === "linear"}
                onClick={() => {
                  setModel("linear");
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  model === "linear"
                    ? "bg-purple-600 text-white"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-white/60 dark:hover:text-white"
                }`}
              >
                Linear
              </button>
              <button
                type="button"
                aria-pressed={model === "cagr"}
                disabled={cagrFit === null}
                onClick={() => {
                  setModel("cagr");
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  model === "cagr"
                    ? "bg-purple-600 text-white"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-white/60 dark:hover:text-white"
                }`}
              >
                CAGR
              </button>
            </div>
          </div>

          {cagrFit === null && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-white/40">Compound projection needs positive history.</p>
          )}

          {paceValue !== null && paceDate !== null && (
            <p className="mt-3 text-sm text-zinc-700 dark:text-white/70">
              At your current pace you&apos;ll reach {formatMoney(paceValue)} {displayCurrency} by{" "}
              {formatDate(paceDate)}.
            </p>
          )}

          <div className="mt-4">
            <label htmlFor="trajectory-target" className="text-xs text-zinc-600 dark:text-white/60">
              Target ({displayCurrency})
            </label>
            <input
              id="trajectory-target"
              type="number"
              inputMode="decimal"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
              }}
              placeholder="e.g. 100000"
              className="mt-1 block w-48 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>

          {hasTarget && (
            <p className="mt-2 text-sm text-zinc-700 dark:text-white/70">
              {etaDate !== null
                ? `You'll reach ${formatMoney(targetValue)} ${displayCurrency} around ${formatDate(etaDate)}.`
                : "On your current trend, you won't reach this."}
            </p>
          )}

          <p className="mt-4 text-xs text-zinc-500 dark:text-white/40">
            An <strong>estimate, not financial advice</strong>, shown in {displayCurrency}.
          </p>
        </div>
      )}
    </div>
  );
}
