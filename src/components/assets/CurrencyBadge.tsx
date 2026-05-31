interface Props {
  currency: "USD" | "EUR" | "PLN";
  cryptoSymbol?: string | null;
}

const colors: Record<"USD" | "EUR" | "PLN", string> = {
  USD: "bg-blue-500",
  EUR: "bg-green-500",
  PLN: "bg-yellow-500",
};

export function CurrencyBadge({ currency, cryptoSymbol }: Props) {
  if (cryptoSymbol) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-white">
        <span className="size-2 rounded-full bg-orange-400" />
        {cryptoSymbol}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-white">
      <span className={`size-2 rounded-full ${colors[currency]}`} />
      {currency}
    </span>
  );
}
