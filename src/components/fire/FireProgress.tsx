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
      <div className="mb-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/10">
        <p className="text-sm tracking-wider text-zinc-500 uppercase dark:text-white/50">FIRE progress</p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-white/60">
          Set your income, expenses, and return assumptions to see your progress toward financial independence.
        </p>
        <a
          href="/dashboard/fire"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
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
    <div className="mb-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/10">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm tracking-wider text-zinc-500 uppercase dark:text-white/50">FIRE progress</p>
        <p
          className={`text-sm font-semibold ${
            fiReached ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-900 dark:text-white"
          }`}
        >
          {formatPercent(pct)}
        </p>
      </div>

      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${
            fiReached ? "bg-emerald-500" : "bg-gradient-to-r from-blue-500 to-purple-500"
          }`}
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

      <p className="mt-4 text-xs text-zinc-500 dark:text-white/40">
        An <strong>estimate, not financial advice</strong>, shown in {displayCurrency} in today&apos;s purchasing power.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-zinc-600 dark:text-white/60">{label}</dt>
      <dd className="text-right text-sm font-semibold whitespace-nowrap text-zinc-900 dark:text-white">{value}</dd>
    </div>
  );
}
