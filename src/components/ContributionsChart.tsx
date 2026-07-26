import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { Pencil } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import type { Currency } from "@/lib/net-worth";
import { buildContributionSplits } from "@/lib/contributions";
import { EditContributionDialog } from "@/components/assets/EditContributionDialog";

type SnapshotRow = Tables<"snapshots">;

const VALID_CURRENCIES: Currency[] = ["USD", "EUR", "PLN"];

/**
 * One Recharts row per interval. An interval is the adjacent pair `(prev, curr)`;
 * the bar is anchored on `curr`'s date. For a known split we populate
 * `contribution` + `growth` (diverging stack around y=0) and leave `unknownTotal`
 * undefined so Recharts skips that bar; for an unrecorded interval we populate
 * `unknownTotal` only. `currId`/`currNetContribution`/`currDate` thread the edit
 * target through to the per-interval edit dialog.
 */
interface ChartRow {
  date: string;
  contribution?: number;
  growth?: number;
  unknownTotal?: number;
  totalChange: number;
  isUnknown: boolean;
  currId: string;
  currNetContribution: number | null;
  currDate: string;
}

interface Props {
  snapshots: SnapshotRow[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

function formatAmount(value: number, currency: Currency): string {
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
  displayCurrency,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  label?: string;
  displayCurrency: Currency;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const date = label ? new Date(label) : null;
  const formattedDate = date
    ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : label;
  return (
    <div className="bg-card text-card-foreground border-border shadow-paper rounded-md border p-3">
      <p className="text-muted-foreground mb-1 text-xs">{formattedDate}</p>
      {row.isUnknown ? (
        <p className="text-foreground/70 max-w-[14rem] text-xs">
          Contribution not recorded for this interval, so the split is unknown. Total change:{" "}
          <span className="tnum text-foreground font-bold">{formatAmount(row.totalChange, displayCurrency)}</span>.
        </p>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-2">
            <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--chart-3)" }} />
            <span className="text-foreground/70">Contribution</span>
            <span className="ml-auto font-semibold">{formatAmount(row.contribution ?? 0, displayCurrency)}</span>
          </p>
          <p className="flex items-center gap-2">
            <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--chart-1)" }} />
            <span className="text-foreground/70">Growth</span>
            <span className="ml-auto font-semibold">{formatAmount(row.growth ?? 0, displayCurrency)}</span>
          </p>
          <p className="border-border flex items-center gap-2 border-t pt-1">
            <span className="text-foreground/70">Total change</span>
            <span className="ml-auto font-semibold">{formatAmount(row.totalChange, displayCurrency)}</span>
          </p>
        </div>
      )}
    </div>
  );
}

export function ContributionsChart({ snapshots, displayCurrency, rates }: Props) {
  // Selected interval index for the edit dialog; null = closed. Imperative
  // dialog open/close is driven by the `open` prop, so we only keep state here.
  const [selected, setSelected] = useState<number | null>(null);

  // Validate each snapshot's stored currency, mirroring NetWorthChart. The split
  // input wants the snapshot's own display currency, falling back to USD.
  const splitInput = snapshots.map((s) => {
    const raw = s.display_currency;
    const pointCurrency: Currency = VALID_CURRENCIES.includes(raw as Currency) ? (raw as Currency) : "USD";
    return {
      totalNetWorth: s.total_net_worth,
      displayCurrency: pointCurrency,
      netContribution: s.net_contribution,
      date: s.created_at,
      currId: s.id,
      currNetContribution: s.net_contribution,
    };
  });

  const intervals = buildContributionSplits(splitInput, displayCurrency, rates);

  // Each interval N maps to snapshot N (the `curr` of the pair); the first
  // snapshot has no predecessor, so splits start at index 1.
  const chartData: ChartRow[] = intervals.map((interval, i) => {
    const curr = splitInput[i + 1];
    const base = {
      date: interval.date,
      totalChange: interval.totalChange,
      currId: curr.currId,
      currNetContribution: curr.currNetContribution,
      currDate: curr.date,
    };
    if (interval.kind === "split") {
      return { ...base, contribution: interval.contribution, growth: interval.growth, isUnknown: false };
    }
    return { ...base, unknownTotal: interval.totalChange, isUnknown: true };
  });

  // Mixed-currency detection mirrors NetWorthChart (a currency change between
  // snapshots makes the raw net-worth subtraction mix currencies).
  const currenciesUsed = new Set(splitInput.map((p) => p.displayCurrency));
  const isMixed = currenciesUsed.size > 1;
  const sortedCurrencies = Array.from(currenciesUsed).sort();
  const changeDate = isMixed
    ? (() => {
        for (let i = 1; i < splitInput.length; i++) {
          if (splitInput[i].displayCurrency !== splitInput[i - 1].displayCurrency) {
            return splitInput[i].date;
          }
        }
        return null;
      })()
    : null;
  const changeDateFormatted = changeDate
    ? new Date(changeDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  const selectedRow = selected !== null ? chartData[selected] : null;

  return (
    <div className="bg-card border-border mt-6 rounded-md border p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Contributions vs Growth</h2>
        <span className="text-muted-foreground text-xs font-bold">{displayCurrency}</span>
      </div>

      {isMixed && changeDateFormatted && (
        <div className="bg-kraft/40 border-kraft text-foreground/80 mb-4 rounded-sm border px-3 py-2 text-xs">
          Your chart mixes {sortedCurrencies.join(" and ")} snapshots from before/after your currency change on{" "}
          {changeDateFormatted}.
        </div>
      )}

      {chartData.length === 0 ? (
        <div className="border-kraft rounded-md border-2 border-dashed p-8 text-center">
          <p className="text-foreground/70 text-sm">
            Save at least two snapshots to see how much of your change came from contributions vs growth.
          </p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }} stackOffset="sign">
              <CartesianGrid stroke="var(--border)" strokeDasharray="5 5" />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-US", { month: "short" })}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickFormatter={(v: number) =>
                  v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                }
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                content={<CustomTooltip displayCurrency={displayCurrency} />}
              />
              <Legend />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" />
              <Bar
                dataKey="contribution"
                name="Contribution"
                stackId="split"
                fill="var(--chart-3)"
                cursor="pointer"
                onClick={(_data, index) => {
                  setSelected(index);
                }}
              />
              <Bar
                dataKey="growth"
                name="Growth"
                stackId="split"
                fill="var(--chart-1)"
                cursor="pointer"
                onClick={(_data, index) => {
                  setSelected(index);
                }}
              />
              <Bar
                dataKey="unknownTotal"
                name="Unknown split"
                fill="var(--muted-foreground)"
                cursor="pointer"
                onClick={(_data, index) => {
                  setSelected(index);
                }}
              />
            </BarChart>
          </ResponsiveContainer>

          <ul className="mt-4 space-y-1">
            {chartData.map((row, i) => (
              <li key={row.date} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-foreground/70">
                  {new Date(row.currDate).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {row.isUnknown && <span className="text-muted-foreground ml-2">unknown split</span>}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(i);
                  }}
                  className="border-primary text-primary hover:bg-primary/8 flex items-center gap-1 rounded-sm border-[1.5px] px-2 py-1 transition-colors"
                  aria-label={`Edit contribution for ${new Date(row.currDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
                >
                  <Pencil className="size-3" />
                  Edit
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {selectedRow && (
        <EditContributionDialog
          open={selected !== null}
          id={selectedRow.currId}
          netContribution={selectedRow.currNetContribution}
          displayCurrency={displayCurrency}
          dateLabel={new Date(selectedRow.currDate).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
          onClose={() => {
            setSelected(null);
          }}
          onSaved={() => {
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
