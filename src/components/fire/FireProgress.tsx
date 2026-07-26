type Currency = "USD" | "EUR" | "PLN";

interface Props {
  configured: boolean;
  percent?: number;
  fireNumber?: number;
  yearsToFi?: number | null;
  runwayMonths?: number | null;
  displayCurrency: Currency;
}

// Small view-edge formatters. Kept local (not imported from FireCalculatorForm)
// so this presentational island stays self-contained, per the plan.
function formatMoney(value: number, currency: Currency): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`;
}

function formatPercent(percent: number): string {
  return `${percent.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

// Runway is rendered as "N months (N.N years)" — whole months, one-decimal years.
function formatRunway(months: number): string {
  const wholeMonths = Math.round(months);
  const years = (months / 12).toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `${wholeMonths.toLocaleString("en-US")} ${wholeMonths === 1 ? "month" : "months"} (${years} years)`;
}

export function FireProgress({ configured, percent, fireNumber, yearsToFi, runwayMonths, displayCurrency }: Props) {
  if (!configured) {
    return (
      <div className="border-kraft mt-6 rounded-md border-2 border-dashed p-6">
        <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">FIRE progress</p>
        <p className="text-foreground/70 mt-2 text-sm">
          Set your income, expenses, and return assumptions to see your progress toward financial independence.
        </p>
        <a
          href="/dashboard/fire"
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 inline-flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors"
        >
          Set up the FIRE calculator
        </a>
      </div>
    );
  }

  // Defensive: the SSR guard already excludes the zero-expense case that would
  // make percent non-finite, but clamp here too so a stray Infinity/NaN never
  // leaks into the width, the label, or aria-valuenow.
  const rawPct = percent ?? 0;
  const pct = Number.isFinite(rawPct) ? Math.max(0, rawPct) : 0;
  const fillWidth = Math.min(pct, 100);
  const fiReached = pct >= 100;

  return (
    <div className="bg-card border-border mt-6 rounded-md border p-6">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">FIRE progress</p>
        <p className={`tnum text-sm font-semibold ${fiReached ? "text-gain" : "text-foreground"}`}>
          {formatPercent(pct)}
        </p>
      </div>

      <div className="bg-secondary mt-2 h-3 w-full overflow-hidden rounded-sm">
        <div
          className="bg-primary h-full rounded-sm transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${fillWidth}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress toward FIRE number"
        />
      </div>

      <dl className="mt-4 space-y-3">
        {yearsToFi != null && (
          <Metric label="Years to FI" value={`${yearsToFi} ${yearsToFi === 1 ? "year" : "years"}`} />
        )}
        {runwayMonths != null && <Metric label="Runway at zero income" value={formatRunway(runwayMonths)} />}
        {fireNumber != null && <Metric label="FIRE number" value={formatMoney(fireNumber, displayCurrency)} />}
      </dl>

      <p className="text-muted-foreground mt-4 text-xs">
        An <strong>estimate, not financial advice</strong>, shown in {displayCurrency} in today&apos;s purchasing power.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-foreground/70 text-sm">{label}</dt>
      <dd className="tnum text-foreground text-right text-sm font-semibold whitespace-nowrap">{value}</dd>
    </div>
  );
}
