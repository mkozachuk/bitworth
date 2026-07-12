interface Props {
  currency: "USD" | "EUR" | "PLN";
  cryptoSymbol?: string | null;
  metalSymbol?: string | null;
}

const colors: Record<"USD" | "EUR" | "PLN", string> = {
  USD: "bg-blue-500",
  EUR: "bg-green-500",
  PLN: "bg-yellow-500",
};

export function CurrencyBadge({ currency, cryptoSymbol, metalSymbol }: Props) {
  if (cryptoSymbol) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-900 dark:bg-white/10 dark:text-white">
        <span className="size-2 rounded-full bg-orange-400" />
        {cryptoSymbol}
      </span>
    );
  }
  if (metalSymbol) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-900 dark:bg-white/10 dark:text-white">
        <span className="size-2 rounded-full bg-amber-500" />
        {metalSymbol}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-900 dark:bg-white/10 dark:text-white">
      <span className={`size-2 rounded-full ${colors[currency]}`} />
      {currency}
    </span>
  );
}
