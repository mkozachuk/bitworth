import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import type { Currency } from "@/lib/net-worth";
import { buildCategoryMix, type CategoryMixItem } from "@/lib/category-mix";
import type { SnapshotItemWithDate } from "@/components/AssetTrendsChart";

// Asset categories take the same five categorical inks as AssetTrendsChart and
// TagTrendsChart, in the same order, cycling beyond five. Liabilities take
// vermilion (the loss color, which the asset cycle excludes), told apart by
// fill opacity, so the band under the axis always reads as debt.
const CHART_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--kraft)"];
const LIABILITY_COLOR = "var(--chart-2)";
const LIABILITY_OPACITIES = [0.55, 0.35, 0.2];

export const NOT_ENOUGH_HISTORY = "Save at least two snapshots to see your category mix over time.";
export const LIABILITIES_EXCLUDED = "Liabilities are not part of the share view: shares are of assets only.";

type Mode = "share" | "absolute";

interface Props {
  snapshotItems: SnapshotItemWithDate[]; // every snapshot's items, with the category join
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

function formatShare(value: number): string {
  return `${value.toFixed(1)}%`;
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
  nameById,
}: {
  active?: boolean;
  payload?: { value: number | null; dataKey: string; color: string }[];
  label?: string;
  mode: Mode;
  displayCurrency: Currency;
  nameById: Map<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const date = label ? new Date(label) : null;
  const formattedDate = date
    ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : label;
  const rows = payload.filter(
    (p): p is typeof p & { value: number } => typeof p.value === "number" && Number.isFinite(p.value),
  );
  if (rows.length === 0) return null;
  return (
    <div className="bg-card text-card-foreground border-border shadow-paper rounded-md border p-3">
      <p className="text-muted-foreground mb-1 text-xs">{formattedDate}</p>
      <div className="space-y-1">
        {[...rows].reverse().map((row) => (
          <p key={row.dataKey} className="flex items-center gap-2 text-sm">
            <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
            <span className="text-foreground/70">{nameById.get(row.dataKey) ?? row.dataKey}</span>
            <span className="tnum ml-auto font-bold">
              {mode === "share" ? formatShare(row.value) : formatAbsolute(row.value, displayCurrency)}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Stacked areas, one per asset category, of what each category held at every
 * snapshot (see src/lib/category-mix.ts). The absolute view stacks assets
 * above the axis and liabilities as a band below it; the share view stacks
 * each asset category's percentage of the assets total, liabilities excluded.
 */
export function CategoryMixChart({ snapshotItems, displayCurrency, rates }: Props) {
  const [mode, setMode] = useState<Mode>("share");

  const items: CategoryMixItem[] = snapshotItems.map((item) => ({
    snapshotId: item.snapshot_id,
    snapshotDate: item.snapshotDate,
    category_id: item.category_id,
    category_name: item.category.name,
    category_order: item.category.display_order,
    is_liability: item.category.is_liability,
    original_amount: item.original_amount,
    original_currency: item.original_currency,
  }));
  const mix = buildCategoryMix(items, displayCurrency, rates);
  const enoughHistory = mix.rows.length >= 2;
  const hasLiabilities = mix.categories.some((c) => c.isLiability);

  // The share view omits the liability series, and a snapshot with no assets
  // (share null) becomes a row without values, a gap rather than a fake 0%.
  const series = mode === "share" ? mix.categories.filter((c) => !c.isLiability) : mix.categories;
  const chartData = mix.rows.map((row) => {
    const values = mode === "share" ? row.share : row.absolute;
    const point: Record<string, number | string | null> = { date: row.date };
    for (const c of series) point[c.id] = values ? values[c.id] : null;
    return point;
  });
  const nameById = new Map(mix.categories.map((c) => [c.id, c.name]));

  let assetIndex = 0;
  let liabilityIndex = 0;
  const styled = series.map((c) => {
    if (c.isLiability) {
      const opacity = LIABILITY_OPACITIES[liabilityIndex++ % LIABILITY_OPACITIES.length];
      return { ...c, stroke: LIABILITY_COLOR, fill: LIABILITY_COLOR, fillOpacity: opacity, stackId: "liabilities" };
    }
    const color = CHART_COLORS[assetIndex++ % CHART_COLORS.length];
    return { ...c, stroke: color, fill: color, fillOpacity: 0.6, stackId: "assets" };
  });

  const yTickFormatter =
    mode === "share"
      ? (v: number) => `${Math.round(v)}%`
      : (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <section aria-labelledby="category-mix-title" className="bg-card border-border mt-6 rounded-md border p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="category-mix-title" className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">
          Category Mix
        </h2>
        {enoughHistory && (
          <fieldset className="flex items-center gap-1" aria-label="Chart view">
            {(["share", "absolute"] as const).map((m) => (
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
                  name="category-mix-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => {
                    setMode(m);
                  }}
                  className="sr-only"
                />
                {m === "share" ? "Share %" : displayCurrency}
              </label>
            ))}
          </fieldset>
        )}
      </div>

      {!enoughHistory ? (
        <div className="border-kraft mt-4 rounded-md border-2 border-dashed p-8 text-center">
          <p className="text-foreground/70 text-sm">{NOT_ENOUGH_HISTORY}</p>
        </div>
      ) : (
        <>
          {mode === "share" && hasLiabilities && (
            <p className="text-muted-foreground mb-3 text-xs">{LIABILITIES_EXCLUDED}</p>
          )}
          <ResponsiveContainer width="100%" height={320} initialDimension={{ width: 600, height: 320 }}>
            <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="5 5" />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-US", { month: "short" })}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickFormatter={yTickFormatter}
                {...(mode === "share" ? { domain: [0, 100], ticks: [0, 25, 50, 75, 100] } : {})}
              />
              {mode === "absolute" && hasLiabilities && <ReferenceLine y={0} stroke="var(--muted-foreground)" />}
              <Tooltip content={<CustomTooltip mode={mode} displayCurrency={displayCurrency} nameById={nameById} />} />
              <Legend />
              {styled.map((c) => (
                <Area
                  key={c.id}
                  type="monotone"
                  dataKey={c.id}
                  name={c.isLiability ? `${c.name} (liability)` : c.name}
                  stackId={c.stackId}
                  stroke={c.stroke}
                  fill={c.fill}
                  fillOpacity={c.fillOpacity}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}
    </section>
  );
}
