import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { Tables } from "@/lib/database.types";

type SnapshotRow = Tables<"snapshots">;
type Currency = "USD" | "EUR" | "PLN";

const VALID_CURRENCIES: Currency[] = ["USD", "EUR", "PLN"];

interface SnapshotPoint {
  date: string;
  netWorth: number;
  displayCurrency: Currency;
}

interface Props {
  snapshots: SnapshotRow[];
  displayCurrency: Currency;
  onSaveSnapshot?: () => void;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; payload: SnapshotPoint }[];
  label?: string;
}) {
  if (active && payload?.length) {
    const date = label ? new Date(label) : null;
    const formattedDate = date
      ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : label;
    const point = payload[0].payload;
    return (
      <div className="rounded-lg border border-zinc-200 bg-white/95 p-3 text-zinc-900 backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white">
        <p className="text-xs text-zinc-600 dark:text-white/60">{formattedDate}</p>
        <p className="text-sm font-semibold">
          {payload[0].value.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          {point.displayCurrency}
        </p>
      </div>
    );
  }
  return null;
}

export function NetWorthChart({ snapshots, displayCurrency, onSaveSnapshot }: Props) {
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

  const changeDateFormatted = changeDate
    ? new Date(changeDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

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
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
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
    </div>
  );
}
