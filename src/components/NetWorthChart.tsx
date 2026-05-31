import { useState } from "react";
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
      <div className="rounded-lg border border-white/10 bg-white/10 p-3 text-white backdrop-blur">
        <p className="text-xs text-white/60">{formattedDate}</p>
        <p className="text-sm font-semibold">
          {Number(payload[0].value).toLocaleString("en-US", {
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
  const [fetchError, setFetchError] = useState<string | null>(null);

  const chartData: SnapshotPoint[] = snapshots.map((s) => ({
    date: s.created_at,
    netWorth: Number(s.total_net_worth),
  }));

  // Find Jan 1st net worth for reference line
  const yearStart = new Date(`${new Date().getFullYear()}-01-01T00:00:00Z`);
  const janSnap = snapshots.find((s) => new Date(s.created_at) <= yearStart);
  const janNetWorth = janSnap ? Number(janSnap.total_net_worth) : null;

  if (snapshots.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="mb-4 text-sm text-white/60">No snapshots yet. Save your first one to see your trend.</p>
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
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-wider text-white/60 uppercase">Net Worth Trend</h2>
        <span className="text-xs text-white/40">{displayCurrency}</span>
      </div>

      {fetchError && <p className="mb-2 text-xs text-red-300">{fetchError}</p>}

      <ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="#ffffff10" strokeDasharray="5 5" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#a1a1aa", fontSize: 12 }}
            tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-US", { month: "short" })}
          />
          <YAxis
            tick={{ fill: "#a1a1aa", fontSize: 12 }}
            tickFormatter={(v: number) =>
              v.toLocaleString("en-US", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })
            }
          />
          <Tooltip content={<CustomTooltip currency={displayCurrency} />} />
          <Line type="monotone" dataKey="netWorth" stroke="#a78bfa" dot={false} strokeWidth={2} />
          {janNetWorth !== null && (
            <ReferenceLine
              y={janNetWorth}
              stroke="#4ade80"
              strokeDasharray="3 3"
              label={{
                value: "Start",
                fill: "#4ade80",
                position: "insideTopRight",
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
