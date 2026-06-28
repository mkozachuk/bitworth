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
      <label htmlFor={id} className="text-sm font-medium text-zinc-700 dark:text-white/80">
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
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 transition-colors focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-white"
      />
      <p className="text-xs text-zinc-500 dark:text-white/50">
        Amount in {currency}: use <span className="font-medium">+</span> for money added,{" "}
        <span className="font-medium">−</span> for money withdrawn. Leave blank if unknown.
      </p>
    </div>
  );
}
