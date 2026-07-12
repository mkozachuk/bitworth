import { useState } from "react";

interface PriceState {
  price: number;
  isCached: boolean;
  cachedAge?: string;
}

interface Props {
  /** Form field name for the symbol input (e.g. "crypto_symbol" or "metal_symbol"). */
  symbolFieldName: string;
  /** Label shown above the quantity input. */
  quantityLabel: React.ReactNode;
  /** Price endpoint to query, e.g. "/api/crypto-price" or "/api/metal-price". */
  priceEndpoint: string;
  /** Which symbol input to render: free-text (crypto) or an XAU/XAG picker (metals). */
  symbolInput: "crypto" | "metals";
  /** Initial symbol value (edit-mode seed). */
  initialSymbol?: string;
  /** Initial quantity value (edit-mode seed). */
  initialQuantity?: string;
}

export function PricedQuantityFields({
  symbolFieldName,
  quantityLabel,
  priceEndpoint,
  symbolInput,
  initialSymbol = "",
  initialQuantity = "",
}: Props) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [price, setPrice] = useState<PriceState | null>(null);
  const [priceStatus, setPriceStatus] = useState<"idle" | "loading" | "success" | "cached" | "error">("idle");
  const [quantity, setQuantity] = useState(initialQuantity);
  const [amount, setAmount] = useState("");

  function fetchPrice(sym: string) {
    setQuantity("");
    if (!sym.trim()) return;
    setPriceStatus("loading");
    fetch(`${priceEndpoint}?symbol=${encodeURIComponent(sym.trim())}`)
      .then((r) => r.json())
      .then(
        (data: {
          price?: number;
          isCached?: boolean;
          cachedAge?: string;
          error?: { code: string; message: string };
        }) => {
          if (data.error) {
            setPriceStatus("error");
            return;
          }
          if (data.price !== undefined && data.isCached !== undefined) {
            const nextPrice = data.price;
            setPrice({ price: nextPrice, isCached: data.isCached, cachedAge: data.cachedAge });
            setPriceStatus(data.isCached ? "cached" : "success");
          }
        },
      )
      .catch(() => {
        setPriceStatus("error");
      });
  }

  return (
    <div className="space-y-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/5">
      <div>
        <label htmlFor={symbolFieldName} className="mb-1 block text-sm text-zinc-700 dark:text-blue-100/80">
          {symbolInput === "metals" ? "Metal" : "Crypto Symbol"}
        </label>
        {symbolInput === "metals" ? (
          <div className="relative">
            <select
              id={symbolFieldName}
              name={symbolFieldName}
              value={symbol}
              onChange={(e) => {
                const next = e.target.value;
                setSymbol(next);
                fetchPrice(next);
              }}
              className="w-full appearance-none rounded-lg border bg-white px-3 py-2 pr-8 text-zinc-900 transition-colors focus:ring-2 focus:outline-none dark:bg-white/10 dark:text-white"
              style={{ borderColor: "rgb(212 212 216)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }}
            >
              <option value="">Select metal…</option>
              <option value="XAU">XAU — Gold</option>
              <option value="XAG">XAG — Silver</option>
            </select>
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-zinc-500 dark:text-white/40">
              ▼
            </span>
          </div>
        ) : (
          <input
            id={symbolFieldName}
            name={symbolFieldName}
            type="text"
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value.toUpperCase());
            }}
            onBlur={() => {
              fetchPrice(symbol);
            }}
            placeholder="BTC, ETH, SOL..."
            className="w-full rounded-lg border bg-white px-3 py-2 text-zinc-900 placeholder-zinc-500 transition-colors focus:ring-2 focus:outline-none dark:bg-white/10 dark:text-white dark:placeholder-white/40"
            style={{ borderColor: "rgb(212 212 216)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }}
          />
        )}
        {priceStatus === "loading" && <p className="mt-1 text-xs text-zinc-500 dark:text-white/50">Fetching price…</p>}
        {(priceStatus === "success" || priceStatus === "cached") && price && (
          <p className="mt-1 text-xs text-zinc-700 dark:text-white/70">
            {symbol} — ${price.price.toLocaleString()}
            {priceStatus === "cached" && ` (cached · ${price.cachedAge ?? ""})`}
          </p>
        )}
        {priceStatus === "error" && <p className="mt-1 text-xs text-zinc-500 dark:text-white/40">Price unavailable</p>}
      </div>

      <div>
        <label htmlFor="quantity" className="mb-1 block text-sm text-zinc-700 dark:text-blue-100/80">
          {quantityLabel}
        </label>
        <input
          id="quantity"
          name="quantity"
          type="number"
          step="any"
          min="0"
          placeholder="0"
          value={quantity}
          onChange={(e) => {
            const next = e.target.value;
            setQuantity(next);
            if (price) {
              const qty = parseFloat(next);
              if (!isNaN(qty) && qty > 0) {
                setAmount(String(Math.round(qty * price.price * 100) / 100));
              }
            }
          }}
          className="w-full rounded-lg border bg-white px-3 py-2 text-zinc-900 placeholder-zinc-500 transition-colors focus:ring-2 focus:outline-none dark:bg-white/10 dark:text-white dark:placeholder-white/40"
          style={{ borderColor: "rgb(212 212 216)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }}
        />
        {price && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-white/40">
            Enter quantity below — total value auto-calculates
          </p>
        )}
      </div>

      <div>
        <label htmlFor="amount" className="mb-1 block text-sm text-zinc-700 dark:text-blue-100/80">
          Total Value (USD) <span className="text-zinc-500 dark:text-white/40">— auto</span>
        </label>
        <input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          readOnly
          placeholder="0.00"
          className="w-full cursor-not-allowed rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-zinc-700 placeholder-zinc-500 transition-colors dark:border-white/20 dark:bg-white/5 dark:text-white/70 dark:placeholder-white/40"
        />
        <input type="hidden" name="currency" value="USD" />
      </div>
    </div>
  );
}
