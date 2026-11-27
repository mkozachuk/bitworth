import type { Tables } from "@/lib/database.types";
import type { ContributionSnapshot } from "@/lib/contributions";
import type { Currency } from "@/lib/net-worth";
import { computePeriodReturns } from "@/lib/period-returns";

// Period-returns card (S-31). TWR leads; simple and Modified Dietz sit in a
// closed details element. A missing contribution breaks the chain, and the
// card says so instead of bridging the gap.

type SnapshotRow = Tables<"snapshots">;

const VALID_CURRENCIES: Currency[] = ["USD", "EUR", "PLN"];

export const EXPLAIN_SIMPLE = "Change in net worth minus your contributions, divided by the starting value.";
export const EXPLAIN_DIETZ =
  "Like simple, but each contribution counts for the part of the period it was invested (assumed mid-interval).";
export const EXPLAIN_TWR =
  "Chains each interval's return, so the size and timing of your contributions do not move the figure.";

interface Props {
  snapshots: SnapshotRow[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

/** 0.0997 -> "9.97%", -0.097 -> "−9.71%", null -> "—". */
export function formatReturn(r: number | null): string {
  if (r === null) return "—";
  const pct = Math.abs(r * 100).toFixed(2);
  return r < 0 ? `−${pct}%` : `${pct}%`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toInput(rows: SnapshotRow[]): ContributionSnapshot[] {
  return rows.map((s) => ({
    totalNetWorth: s.total_net_worth,
    displayCurrency: VALID_CURRENCIES.includes(s.display_currency as Currency)
      ? (s.display_currency as Currency)
      : "USD",
    netContribution: s.net_contribution,
    date: s.created_at,
  }));
}

export function PeriodReturnsCard({ snapshots, displayCurrency, rates }: Props) {
  // Same filter as `comparable` in dashboard.astro: net worth is never
  // re-converted, so only snapshots in the current display currency are compared.
  const comparable = snapshots.filter((s) => s.display_currency === displayCurrency);
  if (comparable.length < 2) return null;

  const result = computePeriodReturns(toInput(comparable), displayCurrency, rates);

  return (
    <section aria-labelledby="period-returns-heading" className="bg-card border-border mt-6 rounded-md border p-6">
      <h2 id="period-returns-heading" className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">
        Period return
      </h2>
      <p className="text-muted-foreground mb-4 text-xs">Net of your contributions</p>

      <div data-testid="period-returns-twr">
        <p className="text-muted-foreground text-xs">
          Time-weighted
          {result.start && result.end ? `, ${formatDate(result.start)} – ${formatDate(result.end)}` : ""}
        </p>
        <p className="tnum mt-1 text-2xl font-bold">{formatReturn(result.twr)}</p>
        <p className="text-muted-foreground mt-1 text-xs">{EXPLAIN_TWR}</p>
      </div>

      {result.breaks.length > 0 && (
        <div role="status" data-testid="period-returns-broken" className="text-foreground/80 mt-3 text-xs">
          <p>Chain broken: contribution not recorded for {result.breaks.map(formatDate).join(", ")}</p>
          <p className="text-muted-foreground">
            covers {result.covered} of {result.total} intervals
          </p>
        </div>
      )}

      <details className="mt-4">
        <summary className="text-muted-foreground cursor-pointer text-xs">Details</summary>
        <dl className="mt-2 grid gap-3">
          <div data-testid="period-returns-simple">
            <dt className="text-muted-foreground text-xs">Simple</dt>
            <dd className="tnum text-sm font-bold">{formatReturn(result.simple)}</dd>
            <dd className="text-muted-foreground text-xs">{EXPLAIN_SIMPLE}</dd>
          </div>
          <div data-testid="period-returns-dietz">
            <dt className="text-muted-foreground text-xs">Modified Dietz</dt>
            <dd className="tnum text-sm font-bold">{formatReturn(result.modifiedDietz)}</dd>
            <dd className="text-muted-foreground text-xs">{EXPLAIN_DIETZ}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
