import { useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import type { MonteCarloBand } from "@/lib/monte-carlo";

type Currency = "USD" | "EUR" | "PLN";

interface Props {
  paths: number[][]; // already sampled to ≤100 by the caller; paths[i] = [b0…bHorizon]
  bands: MonteCarloBand[]; // per-year P10/P50/P90 (length horizon + 1)
  fireNumber: number;
  displayCurrency: Currency;
  totalPathCount: number; // full simulation size, for the "sampled X of Y" log
}

// Recharts wants a flat number formatter; reuse the FireProjectionChart currency
// shape (no decimals, en-US grouping) so both charts read identically.
function formatCurrency(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Only the three percentile bands are worth showing in the tooltip — a payload
// carrying ~100 sampled-path series would be unreadable, so we read p10/p50/p90
// by name and ignore the rest.
function CustomTooltip({
  active,
  payload,
  label,
  displayCurrency,
}: {
  active?: boolean;
  payload?: { dataKey: string | number; value: number }[];
  label?: number;
  displayCurrency: Currency;
}) {
  if (!active || !payload?.length) return null;
  const byKey = new Map(payload.map((p) => [String(p.dataKey), p.value]));
  const rows: { key: string; label: string }[] = [
    { key: "p90", label: "P90 (optimistic)" },
    { key: "p50", label: "P50 (median)" },
    { key: "p10", label: "P10 (pessimistic)" },
  ];
  return (
    <div className="bg-card text-card-foreground border-border shadow-paper rounded-md border p-3">
      <p className="text-muted-foreground mb-1 text-xs">Year {label}</p>
      {rows.map(({ key, label: rowLabel }) => {
        const value = byKey.get(key);
        if (value === undefined) return null;
        return (
          <p key={key} className="text-sm">
            <span className="text-muted-foreground">{rowLabel}: </span>
            <span className="tnum font-bold">
              {formatCurrency(value)} {displayCurrency}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export function MonteCarloChart({ paths, bands, fireNumber, displayCurrency, totalPathCount }: Props) {
  // Make the sampling cap visible rather than silent — the chart plots a subset
  // of the simulated paths, and a reader should be able to confirm the count.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // eslint-disable-next-line no-console
    console.info(`MonteCarloChart: sampled ${paths.length} of ${totalPathCount} paths`);
  }, [paths.length, totalPathCount]);

  // Recharts refuses an empty dataset; guard before building rows.
  if (paths.length === 0 || bands.length === 0) {
    return (
      <div className="border-kraft rounded-md border-2 border-dashed p-8 text-center">
        <p className="text-foreground/70 text-sm">
          Nothing to plot yet — adjust your assumptions to run the simulation.
        </p>
      </div>
    );
  }

  // One wide row per year: { year, path0…pathK, p10, p50, p90 }. Sharing a single
  // data array across every <Line> is the performant Recharts shape (one pass,
  // no per-series re-render).
  const data = bands.map((band) => {
    const row: Record<string, number> = { year: band.year, p10: band.p10, p50: band.p50, p90: band.p90 };
    for (let i = 0; i < paths.length; i++) {
      row[`path${i}`] = paths[i][band.year];
    }
    return row;
  });

  return (
    <div className="bg-card border-border rounded-md border p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">
          Simulated Paths (today&apos;s money)
        </h2>
        <span className="text-muted-foreground text-xs font-bold">{displayCurrency}</span>
      </div>

      <ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }} debounce={50}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="5 5" />
          <XAxis
            dataKey="year"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v: number) => `${v}`}
            label={{
              value: "Years from now",
              position: "insideBottom",
              offset: -2,
              fill: "var(--muted-foreground)",
              fontSize: 12,
            }}
          />
          <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={formatCurrency} />
          <Tooltip content={<CustomTooltip displayCurrency={displayCurrency} />} />
          <Legend />

          {/* Faint sampled paths: drawn first so the bold bands render on top. No
              legend entry, no animation, no dots — element count is the perf lever. */}
          {paths.map((_, i) => (
            <Line
              key={`path${i}`}
              type="monotone"
              dataKey={`path${i}`}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.12}
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
              legendType="none"
            />
          ))}

          {/* Percentile bands: bold, full opacity, with a legend. */}
          <Line
            type="monotone"
            dataKey="p10"
            name="P10 (pessimistic)"
            stroke="var(--loss-soft)"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="p50"
            name="P50 (median)"
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="p90"
            name="P90 (optimistic)"
            stroke="var(--gain-soft)"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />

          <ReferenceLine
            y={fireNumber}
            stroke="var(--chart-2)"
            strokeDasharray="3 3"
            ifOverflow="extendDomain"
            label={{
              value: "FIRE number",
              fill: "var(--chart-2)",
              position: "insideTopRight",
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
