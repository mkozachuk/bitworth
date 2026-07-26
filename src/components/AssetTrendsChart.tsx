import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Eye, EyeOff } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import type { Currency } from "@/lib/net-worth";
import { key } from "@/lib/movers";
import { buildAssetTrends, type TrendItem } from "@/lib/asset-trends";

// Five categorical inks (they resolve per light/dark theme); series beyond five
// cycle the array. Vermilion is excluded — it is the seal and loss color.
const CHART_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--kraft)"];

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };
type SnapshotRow = Tables<"snapshots">;
/** A `snapshot_items` row joined with its category and flattened with its parent snapshot's date. */
export type SnapshotItemWithDate = Tables<"snapshot_items"> & {
  category: Tables<"asset_categories">;
  snapshotDate: string;
};

type Mode = "percent" | "absolute";

interface Props {
  assets: AssetWithCategory[]; // current assets → opted-in line set (show_on_chart) + display names + asset.id
  snapshots: SnapshotRow[]; // ascending by created_at
  snapshotItems: SnapshotItemWithDate[]; // for EVERY snapshot; carries parent date + category join
  displayCurrency: Currency;
  rates: Record<Currency, number>;
  defaultVisible?: boolean; // default false
}

/** Per-line metadata the tooltip needs to render a label + sign for each asset.id dataKey. */
interface LineMeta {
  id: string;
  label: string;
  isLiability: boolean;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function formatAbsolute(value: number, currency: Currency): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function CustomTooltip({
  active,
  payload,
  label,
  mode,
  displayCurrency,
  metaById,
}: {
  active?: boolean;
  payload?: { value: number | null; dataKey: string; color: string }[];
  label?: string;
  mode: Mode;
  displayCurrency: Currency;
  metaById: Map<string, LineMeta>;
}) {
  if (!active || !payload?.length) return null;
  const date = label ? new Date(label) : null;
  const formattedDate = date
    ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : label;
  const rows = payload.filter((p): p is typeof p & { value: number } => p.value !== null);
  if (rows.length === 0) return null;
  return (
    <div className="bg-card text-card-foreground border-border shadow-paper rounded-md border p-3">
      <p className="text-muted-foreground mb-1 text-xs">{formattedDate}</p>
      <div className="space-y-1">
        {rows.map((row) => {
          const meta = metaById.get(row.dataKey);
          const value = row.value;
          return (
            <p key={row.dataKey} className="flex items-center gap-2 text-sm">
              <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              <span className="text-foreground/70">{meta?.label ?? row.dataKey}</span>
              <span className="tnum ml-auto font-bold">
                {mode === "percent" ? formatPercent(value) : formatAbsolute(value, displayCurrency)}
              </span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

function Placeholder({ message }: { message: string }) {
  return (
    <div className="border-kraft mt-4 rounded-md border-2 border-dashed p-8 text-center">
      <p className="text-foreground/70 text-sm">{message}</p>
    </div>
  );
}

export function AssetTrendsChart({
  assets,
  snapshots,
  snapshotItems,
  displayCurrency,
  rates,
  defaultVisible = false,
}: Props) {
  const [visible, setVisible] = useState(defaultVisible);
  const [mode, setMode] = useState<Mode>("percent");

  // Opted-in current assets define which lines we draw and their display id/name.
  const optedIn = assets.filter((a) => a.show_on_chart);

  // Build every series from all-snapshot items, then match each opted-in asset to
  // its series on the same `(name, category_id)` identity the builder groups by.
  const trendItems: TrendItem[] = snapshotItems.map((item) => ({
    snapshotId: item.snapshot_id,
    snapshotDate: item.snapshotDate,
    name: item.name,
    category_id: item.category_id,
    original_amount: item.original_amount,
    original_currency: item.original_currency,
    is_liability: item.category.is_liability,
    icon: item.category.icon,
  }));
  const seriesByKey = new Map(
    buildAssetTrends(trendItems, displayCurrency, rates).map((s) => [key(s.name, s.category_id), s]),
  );

  const lines = optedIn
    .map((asset) => ({ asset, series: seriesByKey.get(key(asset.name, asset.category_id)) }))
    .filter((l): l is { asset: AssetWithCategory; series: NonNullable<typeof l.series> } => l.series !== undefined);

  // Recharts rows keyed by snapshot date; absent points map to null so the line breaks.
  const valueKey = mode === "percent" ? "indexed" : "value";
  const chartData = snapshots.map((s) => {
    const row: Record<string, number | null | string> = { date: s.created_at };
    for (const { asset, series } of lines) {
      const point = series.points.find((p) => p.date === s.created_at);
      row[asset.id] = point ? point[valueKey] : null;
    }
    return row;
  });

  const metaById = new Map<string, LineMeta>(
    lines.map(({ asset, series }) => {
      const base = asset.name;
      return [
        asset.id,
        { id: asset.id, label: series.is_liability ? `${base} (liability)` : base, isLiability: series.is_liability },
      ];
    }),
  );

  const yTickFormatter =
    mode === "percent"
      ? (v: number) => `${Math.round(v)}%`
      : (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="bg-card border-border mt-6 rounded-md border p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Asset Trends</h2>
        <div className="flex items-center gap-3">
          {visible && (
            <fieldset className="flex items-center gap-1" aria-label="Chart scale">
              {(["percent", "absolute"] as const).map((m) => (
                <label
                  key={m}
                  className={`cursor-pointer rounded-sm border px-2 py-1 text-xs transition-colors ${
                    mode === m
                      ? "border-primary bg-primary text-primary-foreground font-medium"
                      : "border-border text-foreground/70 hover:border-primary hover:text-primary"
                  }`}
                >
                  <input
                    type="radio"
                    name="trend-mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => {
                      setMode(m);
                    }}
                    className="sr-only"
                  />
                  {m === "percent" ? "%" : displayCurrency}
                </label>
              ))}
            </fieldset>
          )}
          <button
            type="button"
            onClick={() => {
              setVisible((v) => !v);
            }}
            className="text-foreground/60 hover:text-foreground transition-colors"
            aria-label={visible ? "Hide asset trends" : "Show asset trends"}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      {!visible ? null : snapshots.length < 2 ? (
        <Placeholder message="Save at least two snapshots to see asset trends over time." />
      ) : lines.length === 0 ? (
        <Placeholder message="No assets are marked “Show on chart” yet. Enable it on an asset to see its trend." />
      ) : (
        <ResponsiveContainer width="100%" height={320} initialDimension={{ width: 600, height: 320 }}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="5 5" />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-US", { month: "short" })}
            />
            <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={yTickFormatter} />
            <Tooltip content={<CustomTooltip mode={mode} displayCurrency={displayCurrency} metaById={metaById} />} />
            <Legend />
            {lines.map(({ asset }, i) => (
              <Line
                key={asset.id}
                type="monotone"
                dataKey={asset.id}
                name={metaById.get(asset.id)?.label ?? asset.name}
                connectNulls={false}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                dot={false}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
