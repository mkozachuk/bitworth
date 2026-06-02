import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { Tables } from "@/lib/database.types";

type SnapshotRow = Tables<"snapshots">;
type Currency = "USD" | "EUR" | "PLN";

interface SnapshotPoint {
  date: string;
  netWorth: number;
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
  currency,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  currency: Currency;
}) {
  if (active && payload?.length) {
    const date = label ? new Date(label) : null;
    const formattedDate = date
      ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : label;
    return (
      <div className="rounded-lg border border-zinc-200 bg-white/95 p-3 text-zinc-900 backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white">
        <p className="text-xs text-zinc-600 dark:text-white/60">{formattedDate}</p>
        <p className="text-sm font-semibold">
          {payload[0].value.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          {currency}
        </p>
      </div>
    );
  }
  return null;
}

export function NetWorthChart({ snapshots, displayCurrency, onSaveSnapshot }: Props) {
  const chartData: SnapshotPoint[] = snapshots.map((s) => ({
    date: s.created_at,
    netWorth: s.total_net_worth,
  }));

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

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 dark:border-white/10 dark:bg-white/5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-wider text-zinc-600 uppercase dark:text-white/60">
          Net Worth Trend
        </h2>
        <span className="text-xs text-zinc-500 dark:text-white/40">{displayCurrency}</span>
      </div>

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
          <Tooltip content={<CustomTooltip currency={displayCurrency} />} />
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
