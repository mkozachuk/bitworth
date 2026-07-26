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
      <div className="bg-card text-card-foreground border-border shadow-paper rounded-md border p-3">
        <p className="text-muted-foreground text-xs">
          {formattedDate}
          {isProjected ? " (projected)" : ""}
        </p>
        <p className="tnum text-sm font-bold">
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
      <div className="border-kraft mt-6 rounded-md border-2 border-dashed p-8 text-center">
        <svg
          viewBox="0 0 160 56"
          className="text-primary/50 mx-auto mb-3 h-12 w-36"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 40 L44 22 L66 32 L102 12 L124 20 L148 8" strokeWidth="2.5" strokeDasharray="3 6" />
          <path d="M12 48 H148" strokeWidth="1.5" strokeDasharray="1 5" />
          <circle cx="148" cy="8" r="3" strokeWidth="2" />
        </svg>
        <p className="text-foreground/60 mb-1 text-xs font-bold tracking-[0.12em] uppercase">Net worth trend</p>
        <p className="text-foreground/70 mb-4 text-sm">This compartment is empty — no snapshots saved yet.</p>
        <button
          onClick={() => onSaveSnapshot?.()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm px-6 py-2 text-sm font-medium transition-colors"
        >
          Stamp your first snapshot
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

  // One tick per calendar month — several snapshots in a month would otherwise
  // print "May May May" along the axis. January ticks carry the year.
  const monthTicks: string[] = [];
  let lastMonthKey = "";
  for (const p of renderData) {
    const d = new Date(p.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== lastMonthKey) {
      monthTicks.push(p.date);
      lastMonthKey = key;
    }
  }

  const targetValue = target.trim() === "" ? null : Number(target);
  const hasTarget = targetValue !== null && Number.isFinite(targetValue);
  const etaT = projectionOn && hasTarget ? etaToTarget(activeFit, targetValue, lastT) : null;
  const etaDate = etaT !== null ? new Date(originMs + etaT * MS_PER_DAY).toISOString() : null;

  return (
    <div className="bg-card border-border mt-6 rounded-md border p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Net worth trend</h2>
        <span className="text-muted-foreground text-xs font-bold">{displayCurrency}</span>
      </div>

      {isMixed && changeDateFormatted && (
        <div className="bg-kraft/40 border-kraft text-foreground/80 mb-4 rounded-sm border px-3 py-2 text-xs">
          Your chart mixes {sortedCurrencies.join(" and ")} snapshots from before/after your currency change on{" "}
          {changeDateFormatted}.
        </div>
      )}

      <ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}>
        <LineChart data={renderData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="5 5" />
          <XAxis
            dataKey="date"
            ticks={monthTicks}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v: string) => {
              const d = new Date(v);
              const month = d.toLocaleDateString("en-US", { month: "short" });
              return d.getMonth() === 0 ? `${month} ${d.getFullYear()}` : month;
            }}
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
        <p className="text-muted-foreground mt-4 text-xs">
          Not enough history yet — save more snapshots to see a projection.
        </p>
      )}

      {projectionOn && (
        <div className="border-border mt-6 border-t pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Projection</span>
            <div
              role="group"
              aria-label="Projection model"
              className="border-border inline-flex rounded-sm border p-0.5"
            >
              <button
                type="button"
                aria-pressed={model === "linear"}
                onClick={() => {
                  setModel("linear");
                }}
                className={`rounded-sm px-3 py-1 text-xs font-medium transition-colors ${
                  model === "linear" ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"
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
                className={`rounded-sm px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  model === "cagr" ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"
                }`}
              >
                CAGR
              </button>
            </div>
          </div>

          {cagrFit === null && (
            <p className="text-muted-foreground mt-2 text-xs">Compound projection needs positive history.</p>
          )}

          {paceValue !== null && paceDate !== null && (
            <p className="text-foreground/80 tnum mt-3 text-sm">
              At your current pace you&apos;ll reach {formatMoney(paceValue)} {displayCurrency} by{" "}
              {formatDate(paceDate)}.
            </p>
          )}

          <div className="mt-4">
            <label htmlFor="trajectory-target" className="text-foreground/70 text-xs font-medium">
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
              className="tnum border-input bg-card text-foreground focus:border-primary mt-1 block w-48 rounded-sm border px-3 py-1.5 text-sm focus:outline-none"
            />
          </div>

          {hasTarget && (
            <p className="text-foreground/80 tnum mt-2 text-sm">
              {etaDate !== null
                ? `You'll reach ${formatMoney(targetValue)} ${displayCurrency} around ${formatDate(etaDate)}.`
                : "On your current trend, you won't reach this."}
            </p>
          )}

          <p className="text-muted-foreground mt-4 text-xs">
            An <strong>estimate, not financial advice</strong>, shown in {displayCurrency}.
          </p>
        </div>
      )}
    </div>
  );
}
