// Server-rendered notice for the dashboard pages: shown only when getRates
// fell back to the fixed STATIC_RATES because live rates were unavailable.

interface Props {
  approximate: boolean;
}

export const APPROXIMATE_RATES_LABEL = "Approximate rate";
export const APPROXIMATE_RATES_EXPLAIN = "Live exchange rates are unavailable, so fixed fallback rates are in use.";

export function ApproximateRatesNotice({ approximate }: Props) {
  if (!approximate) return null;
  return (
    <div
      role="status"
      data-testid="approximate-rates"
      className="border-border bg-card text-foreground mb-4 rounded-sm border px-4 py-2 text-sm"
    >
      <strong className="font-medium">{APPROXIMATE_RATES_LABEL}</strong> {APPROXIMATE_RATES_EXPLAIN}
    </div>
  );
}
