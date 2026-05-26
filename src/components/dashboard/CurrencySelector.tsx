import type { Currency } from "@/lib/net-worth";

const OPTIONS: { value: Currency; label: string }[] = [
  { value: "PLN", label: "PLN" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
];

interface CurrencySelectorProps {
  value: Currency;
  onChange: (currency: Currency) => void;
}

export function CurrencySelector({ value, onChange }: CurrencySelectorProps) {
  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newCurrency = e.target.value as Currency;
    onChange(newCurrency);

    try {
      await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_currency: newCurrency }),
      });
    } catch {
      // Silently fail — the onChange already updated local state
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-sm text-white/50">Display:</span>
      <select
        value={value}
        onChange={handleChange}
        className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-sm text-white focus:ring-2 focus:ring-white/20 focus:outline-none"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
