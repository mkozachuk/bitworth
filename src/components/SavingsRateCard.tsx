import type { Tables } from "@/lib/database.types";
import type { Currency } from "@/lib/net-worth";
import { summarizeSavingsRates, type RateLabel, type SavingsRateSnapshot } from "@/lib/savings-rate";

type SnapshotRow = Tables<"snapshots">;

const VALID_CURRENCIES: Currency[] = ["USD", "EUR", "PLN"];

/** Shown, verbatim, when no interval has a known rate. The card itself is never absent. */
export const NOTHING_KNOWN = "Add income to a snapshot to see your savings rate";

interface Props {
  snapshots: SnapshotRow[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

/** Snapshot rows → the pure module's input; mirrors ContributionsChart's currency fallback. */
export function toSavingsRateInput(snapshots: SnapshotRow[]): SavingsRateSnapshot[] {
  return snapshots.map((s) => ({
    totalNetWorth: s.total_net_worth,
    displayCurrency: VALID_CURRENCIES.includes(s.display_currency as Currency)
      ? (s.display_currency as Currency)
      : "USD",
    netContribution: s.net_contribution,
    // `?? null`: a row read before the income migration has no key at all.
    income: s.income ?? null,
    date: s.created_at,
  }));
}

/** 0.255 → "25.5%", -0.2 → "−20.0%". Only ever called with a finite rate. */
export function formatRate(rate: number): string {
  const pct = Math.abs(rate * 100).toFixed(1);
  return rate < 0 ? `−${pct}%` : `${pct}%`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function LabelChip({ label }: { label: RateLabel | null }) {
  if (!label) return null;
  return (
    <span className="border-kraft text-foreground/80 ml-2 rounded-sm border px-1.5 py-0.5 align-middle text-xs font-medium">
      {label}
    </span>
  );
}

/**
 * Headline savings-rate card (S-24): the latest interval's rate and the mean of
 * the last 6 known rates, each with its context. Unknown is shown as words,
 * never as 0%. Rates over 100% or under 0% are shown as they are, with a label.
 */
export function SavingsRateCard({ snapshots, displayCurrency, rates }: Props) {
  const summary = summarizeSavingsRates(toSavingsRateInput(snapshots), displayCurrency, rates);
  const { latest, average, averageLabel, averageCount } = summary;

  return (
    <section aria-labelledby="savings-rate-heading" className="bg-card border-border mt-6 rounded-md border p-6">
      <h2 id="savings-rate-heading" className="text-foreground/60 mb-4 text-xs font-bold tracking-[0.12em] uppercase">
        Savings rate
      </h2>

      {average === null ? (
        <p className="text-foreground/70 text-sm">{NOTHING_KNOWN}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div data-testid="savings-rate-latest">
            <p className="text-muted-foreground text-xs">
              Latest interval{latest ? `, to ${formatDate(latest.date)}` : ""}
            </p>
            {latest?.rate != null ? (
              <p className="tnum mt-1 text-2xl font-bold">
                {formatRate(latest.rate)}
                <LabelChip label={latest.label} />
              </p>
            ) : (
              <p className="text-foreground/70 mt-1 text-sm">Not known yet: add its income or contribution</p>
            )}
          </div>
          <div data-testid="savings-rate-average">
            <p className="text-muted-foreground text-xs">avg of {averageCount} known</p>
            <p className="tnum mt-1 text-2xl font-bold">
              {formatRate(average)}
              <LabelChip label={averageLabel} />
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
