import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { Currency } from "@/lib/net-worth";
import { buildTagTrends, type TagTrendItem } from "@/lib/tag-trends";
import type { SnapshotItemWithDate } from "@/components/AssetTrendsChart";

// The same five categorical inks as AssetTrendsChart, in the same order; lines
// beyond five cycle the array. Vermilion is excluded: it is the seal and loss color.
const CHART_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--kraft)"];

export const NOT_ENOUGH_HISTORY = "Not enough history yet — tags are recorded from your next snapshot";

type Mode = "percent" | "absolute";

/** A tag whose "show on dashboard" toggle is on. */
export interface DashboardTag {
  id: string;
  name: string;
}

interface Props {
  tags: DashboardTag[]; // the tags with show_on_dashboard; empty → no card at all
  snapshotItems: SnapshotItemWithDate[]; // every snapshot's items, with recorded tag_ids
  displayCurrency: Currency;
  rates: Record<Currency, number>;
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
  const rows = payload.filter((p): p is typeof p & { value: number } => p.value !== null);
  if (rows.length === 0) return null;
  return (
    <div className="bg-card text-card-foreground border-border shadow-paper rounded-md border p-3">
      <p className="text-muted-foreground mb-1 text-xs">{formattedDate}</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <p key={row.dataKey} className="flex items-center gap-2 text-sm">
            <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
            <span className="text-foreground/70">{nameById.get(row.dataKey) ?? row.dataKey}</span>
            <span className="tnum ml-auto font-bold">
              {mode === "percent" ? formatPercent(row.value) : formatAbsolute(row.value, displayCurrency)}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * One line per tag the user put on the dashboard (Settings → Tags). A point is
 * the tag's assets' summed value at a snapshot, from the tags recorded on that
 * snapshot when it was saved (see src/lib/tag-trends.ts). Lines are separate,
 * never stacked: an asset with two tags is in both.
 */
export function TagTrendsChart({ tags, snapshotItems, displayCurrency, rates }: Props) {
  const [mode, setMode] = useState<Mode>("percent");

  if (tags.length === 0) return null;

  const items: TagTrendItem[] = snapshotItems.map((item) => ({
    snapshotId: item.snapshot_id,
    snapshotDate: item.snapshotDate,
    original_amount: item.original_amount,
    original_currency: item.original_currency,
    is_liability: item.category.is_liability,
    tag_ids: item.tag_ids,
  }));
  const series = buildTagTrends(
    items,
    tags.map((t) => t.id),
    displayCurrency,
    rates,
  );

  // X rows: every snapshot from the first one with recorded tags onward. Older
  // snapshots predate tag recording and would only add an empty span; a later
  // snapshot without recorded tags stays as a row with nulls, so the lines
  // break there instead of bridging it.
  const recordedDates = new Set(series.flatMap((s) => s.points.map((p) => p.date)));
  const allDates = [...new Set(snapshotItems.map((i) => i.snapshotDate))].sort((a, b) => a.localeCompare(b));
  const firstRecorded = allDates.findIndex((d) => recordedDates.has(d));
  const rowDates = firstRecorded < 0 ? [] : allDates.slice(firstRecorded);

  const valueKey = mode === "percent" ? "indexed" : "value";
  const chartData = rowDates.map((date) => {
    const row: Record<string, number | null | string> = { date };
    for (const s of series) {
      const point = s.points.find((p) => p.date === date);
      row[s.tagId] = point ? point[valueKey] : null;
    }
    return row;
  });

  const nameById = new Map(tags.map((t) => [t.id, t.name]));
  const enoughHistory = recordedDates.size >= 2;

  const yTickFormatter =
    mode === "percent"
      ? (v: number) => `${Math.round(v)}%`
      : (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <section aria-labelledby="tag-trends-title" className="bg-card border-border mt-6 rounded-md border p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="tag-trends-title" className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">
          Tag Trends
        </h2>
        {enoughHistory && (
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
                  name="tag-trend-mode"
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
      </div>

      {!enoughHistory ? (
        <div className="border-kraft mt-4 rounded-md border-2 border-dashed p-8 text-center">
          <p className="text-foreground/70 text-sm">{NOT_ENOUGH_HISTORY}</p>
        </div>
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
            <Tooltip content={<CustomTooltip mode={mode} displayCurrency={displayCurrency} nameById={nameById} />} />
            <Legend />
            {tags.map((tag, i) => (
              <Line
                key={tag.id}
                type="monotone"
                dataKey={tag.id}
                name={tag.name}
                connectNulls={false}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
