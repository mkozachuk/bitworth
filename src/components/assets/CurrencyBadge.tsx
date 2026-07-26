interface Props {
  currency: "USD" | "EUR" | "PLN";
  cryptoSymbol?: string | null;
  metalSymbol?: string | null;
}

export function CurrencyBadge({ currency, cryptoSymbol, metalSymbol }: Props) {
  if (cryptoSymbol) {
    return (
      <span className="bg-kraft/60 text-foreground/80 border-foreground/15 inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-bold">
        {cryptoSymbol}
      </span>
    );
  }
  if (metalSymbol) {
    return (
      <span className="bg-kraft/60 text-foreground/80 border-foreground/15 inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-bold">
        {metalSymbol}
      </span>
    );
  }
  return (
    <span className="bg-kraft/60 text-foreground/80 border-foreground/15 inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-bold">
      {currency}
    </span>
  );
}
