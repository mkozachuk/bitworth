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
    <div className="border-border bg-card space-y-4 rounded-md border p-4">
      <div>
        <label htmlFor={symbolFieldName} className="text-foreground/70 mb-1 block text-sm">
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
              className="border-input bg-card text-foreground focus:border-primary w-full appearance-none rounded-sm border px-3 py-2 pr-8 transition-colors focus:outline-none"
            >
              <option value="">Select metal…</option>
              <option value="XAU">XAU — Gold</option>
              <option value="XAG">XAG — Silver</option>
            </select>
            <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
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
            className="border-input bg-card text-foreground placeholder:text-muted-foreground focus:border-primary w-full rounded-sm border px-3 py-2 transition-colors focus:outline-none"
          />
        )}
        {priceStatus === "loading" && <p className="text-muted-foreground mt-1 text-xs">Fetching price…</p>}
        {(priceStatus === "success" || priceStatus === "cached") && price && (
          <p className="text-foreground/70 tnum mt-1 text-xs">
            {symbol} — ${price.price.toLocaleString()}
            {priceStatus === "cached" && ` (cached · ${price.cachedAge ?? ""})`}
          </p>
        )}
        {priceStatus === "error" && <p className="text-muted-foreground mt-1 text-xs">Price unavailable</p>}
      </div>

      <div>
        <label htmlFor="quantity" className="text-foreground/70 mb-1 block text-sm">
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
          className="border-input bg-card text-foreground placeholder:text-muted-foreground focus:border-primary tnum w-full rounded-sm border px-3 py-2 transition-colors focus:outline-none"
        />
        {price && (
          <p className="text-muted-foreground mt-1 text-xs">Enter quantity below — total value auto-calculates</p>
        )}
      </div>

      <div>
        <label htmlFor="amount" className="text-foreground/70 mb-1 block text-sm">
          Total Value (USD) <span className="text-muted-foreground">— auto</span>
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
          className="border-input bg-muted text-foreground/70 placeholder:text-muted-foreground tnum w-full cursor-not-allowed rounded-sm border px-3 py-2 transition-colors"
        />
        <input type="hidden" name="currency" value="USD" />
      </div>
    </div>
  );
}
