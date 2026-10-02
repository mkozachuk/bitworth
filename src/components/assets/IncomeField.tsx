import type { Currency } from "@/lib/net-worth";

export interface IncomeFieldProps {
  /** Controlled raw input value (string so it can be blank = unknown). */
  value: string;
  /** Called with the raw string on every change; parent owns parsing/submission. */
  onChange: (value: string) => void;
  /** Display currency shown in the helper line. */
  currency: Currency;
  /** Optional id so a parent <label> can associate with the input. */
  id?: string;
  /** Optional disabled state (e.g. while the parent is submitting). */
  disabled?: boolean;
}

/**
 * Presentational, controlled input for the income earned in the interval that
 * ends at a snapshot (S-24). Never negative. Blank = unknown, which leaves the
 * interval's savings rate unknown. Sits next to ContributionField and follows
 * its shape; no submission logic lives here.
 */
export function IncomeField({ value, onChange, currency, id = "income", disabled }: IncomeFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-foreground/70 text-sm font-medium">
        Income (after tax)
      </label>
      <input
        id={id}
        type="number"
        step="any"
        min="0"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder="e.g. 4000"
        className="border-input bg-card text-foreground focus:border-primary tnum w-full rounded-sm border px-3 py-2 text-sm transition-colors focus:outline-none disabled:opacity-50"
      />
      <p className="text-muted-foreground text-xs">
        Amount in {currency} earned since your previous snapshot. Used for your savings rate. Leave blank if unknown.
      </p>
    </div>
  );
}
