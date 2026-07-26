import type { Currency } from "@/lib/net-worth";

export interface ContributionFieldProps {
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
 * Presentational, controlled input for a signed net-contribution amount.
 * Positive = money added, negative = money withdrawn. Blank = unknown split.
 * No submission logic lives here — the parent reads `value` and decides.
 */
export function ContributionField({
  value,
  onChange,
  currency,
  id = "net-contribution",
  disabled,
}: ContributionFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-foreground/70 text-sm font-medium">
        Net contribution
      </label>
      <input
        id={id}
        type="number"
        step="any"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder="e.g. 500 or -200"
        className="border-input bg-card text-foreground focus:border-primary tnum w-full rounded-sm border px-3 py-2 text-sm transition-colors focus:outline-none disabled:opacity-50"
      />
      <p className="text-muted-foreground text-xs">
        Amount in {currency}: use <span className="font-medium">+</span> for money added,{" "}
        <span className="font-medium">−</span> for money withdrawn. Leave blank if unknown.
      </p>
    </div>
  );
}
