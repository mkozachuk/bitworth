import { useState } from "react";
import { Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";
import { CategorySelect } from "./CategorySelect";
import type { Tables } from "@/lib/database.types";

interface Props {
  asset?: Tables<"assets">;
  mode: "create" | "edit";
  onCancel?: () => void;
  serverError?: string | null;
}

interface FormErrors {
  name?: string;
  amount?: string;
  currency?: string;
  category_id?: string;
}

export function AssetForm({ asset, mode, onCancel, serverError }: Props) {
  const [name, setName] = useState(asset ? asset.name : "");
  const [amount, setAmount] = useState(asset ? String(asset.amount) : "");
  const [currency, setCurrency] = useState<"USD" | "EUR" | "PLN">(
    asset ? (asset.currency as "USD" | "EUR" | "PLN") : "USD",
  );
  const [categoryId, setCategoryId] = useState(asset ? asset.category_id : "");
  const [notes, setNotes] = useState(asset ? (asset.notes ?? "") : "");
  const [cryptoSymbol, setCryptoSymbol] = useState(asset ? (asset.crypto_symbol ?? "") : "");
  const [cryptoPrice, setCryptoPrice] = useState<{ price: number; isCached: boolean } | null>(null);
  const [priceStatus, setPriceStatus] = useState<"idle" | "loading" | "success" | "cached" | "error">("idle");
  const [quantity, setQuantity] = useState(asset ? (asset.quantity != null ? String(asset.quantity) : "") : "");
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);

  function validate(): boolean {
    const next: FormErrors = {};
    if (!name.trim()) {
      next.name = "Name is required";
    }
    // For crypto, amount is auto-calculated from quantity × price — skip validation
    if (categoryId !== "crypto") {
      const amountNum = parseFloat(amount);
      if (!amount.trim()) {
        next.amount = "Amount is required";
      } else if (isNaN(amountNum)) {
        next.amount = "Enter a valid number";
      } else if (amountNum <= 0) {
        next.amount = "Amount must be greater than zero";
      }
    }
    if (!categoryId) {
      next.category_id = "Category is required";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof FormErrors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;
    setPending(true);

    const form = e.currentTarget;
    const endpoint = mode === "create" ? "/api/assets" : `/api/assets/${asset ? asset.id : ""}`;
    const method = mode === "create" ? "POST" : "PUT";

    try {
      const formData = new FormData(form);
      const res = await fetch(endpoint, { method, body: formData });
      const json = (await res.json()) as { data?: unknown; error?: { code: string; message: string } };

      if (json.error) {
        e.preventDefault();
        setPending(false);
        return;
      }

      if (mode === "create") {
        window.location.href = "/dashboard/assets";
      } else {
        window.location.href = "/dashboard/assets";
      }
    } catch {
      e.preventDefault();
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <ServerError message={serverError} />

      <div>
        <label htmlFor="name" className="mb-1 block text-sm text-blue-100/80">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            clearError("name");
          }}
          placeholder="e.g. Savings account"
          className="w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none"
          style={
            errors.name
              ? { borderColor: "rgb(148 163 184 / 0.6)", boxShadow: "0 0 0 2px rgba(248,113,113,0.4)" }
              : { borderColor: "rgba(255,255,255,0.2)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }
          }
        />
        {errors.name && <p className="mt-1 text-xs text-red-300">{errors.name}</p>}
      </div>

      {categoryId !== "crypto" && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="amount" className="mb-1 block text-sm text-blue-100/80">
              Amount
            </label>
            <input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                clearError("amount");
              }}
              placeholder="0.00"
              className="w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none"
              style={
                errors.amount
                  ? { borderColor: "rgb(148 163 184 / 0.6)", boxShadow: "0 0 0 2px rgba(248,113,113,0.4)" }
                  : { borderColor: "rgba(255,255,255,0.2)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }
              }
            />
            {errors.amount && <p className="mt-1 text-xs text-red-300">{errors.amount}</p>}
          </div>

          <div>
            <label htmlFor="currency" className="mb-1 block text-sm text-blue-100/80">
              Currency
            </label>
            <div className="relative">
              <select
                id="currency"
                name="currency"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value as "USD" | "EUR" | "PLN");
                  clearError("currency");
                }}
                className="w-full appearance-none rounded-lg border bg-white/10 px-3 py-2 pr-8 text-white transition-colors focus:ring-2 focus:outline-none"
                style={
                  errors.currency
                    ? { borderColor: "rgb(148 163 184 / 0.6)", boxShadow: "0 0 0 2px rgba(248,113,113,0.4)" }
                    : { borderColor: "rgba(255,255,255,0.2)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }
                }
              >
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="PLN">PLN — Polish Zloty</option>
              </select>
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-white/40">
                ▼
              </span>
            </div>
            {errors.currency && <p className="mt-1 text-xs text-red-300">{errors.currency}</p>}
          </div>
        </div>
      )}

      <CategorySelect
        value={categoryId}
        onChange={(id) => {
          setCategoryId(id);
          clearError("category_id");
        }}
        error={errors.category_id}
      />

      {categoryId === "crypto" && (
        <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-4">
          <div>
            <label htmlFor="crypto_symbol" className="mb-1 block text-sm text-blue-100/80">
              Crypto Symbol
            </label>
            <input
              id="crypto_symbol"
              name="crypto_symbol"
              type="text"
              value={cryptoSymbol}
              onChange={(e) => {
                setCryptoSymbol(e.target.value.toUpperCase());
              }}
              onBlur={() => {
                setQuantity("");
                if (!cryptoSymbol.trim()) return;
                setPriceStatus("loading");
                fetch(`/api/crypto-price?symbol=${encodeURIComponent(cryptoSymbol.trim())}`)
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
                        setCryptoPrice({ price: data.price, isCached: data.isCached });
                        setPriceStatus(data.isCached ? "cached" : "success");
                        if (quantity) {
                          const qty = parseFloat(quantity);
                          if (!isNaN(qty) && qty > 0) {
                            setAmount(String(Math.round(qty * data.price * 100) / 100));
                          }
                        }
                        if (data.cachedAge) {
                          setCryptoPrice((prev) => (prev ? { ...prev } : null));
                        }
                      }
                    },
                  )
                  .catch(() => {
                    setPriceStatus("error");
                  });
              }}
              placeholder="BTC, ETH, SOL..."
              className="w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none"
              style={{ borderColor: "rgba(255,255,255,0.2)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }}
            />
            {priceStatus === "loading" && <p className="mt-1 text-xs text-white/50">Fetching price…</p>}
            {(priceStatus === "success" || priceStatus === "cached") && cryptoPrice && (
              <p className="mt-1 text-xs text-white/70">
                {cryptoSymbol} — ${cryptoPrice.price.toLocaleString()}
                {priceStatus === "cached" && ` (cached · ${(cryptoPrice as { cachedAge?: string }).cachedAge ?? ""})`}
              </p>
            )}
            {priceStatus === "error" && <p className="mt-1 text-xs text-white/40">Price unavailable</p>}
          </div>

          <div>
            <label htmlFor="quantity" className="mb-1 block text-sm text-blue-100/80">
              Quantity <span className="text-white/40">(e.g., 0.5 BTC)</span>
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
                setQuantity(e.target.value);
                if (cryptoPrice) {
                  const qty = parseFloat(e.target.value);
                  if (!isNaN(qty) && qty > 0) {
                    setAmount(String(Math.round(qty * cryptoPrice.price * 100) / 100));
                  }
                }
              }}
              className="w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none"
              style={{ borderColor: "rgba(255,255,255,0.2)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }}
            />
            {cryptoPrice && (
              <p className="mt-1 text-xs text-white/40">Enter quantity below — total value auto-calculates</p>
            )}
          </div>

          <div>
            <label htmlFor="amount" className="mb-1 block text-sm text-blue-100/80">
              Total Value (USD) <span className="text-white/40">— auto</span>
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
              className="w-full cursor-not-allowed rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white/70 placeholder-white/40 transition-colors"
            />
            <input type="hidden" name="currency" value="USD" />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="notes" className="mb-1 block text-sm text-blue-100/80">
          Notes <span className="text-white/40">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
          placeholder="Any additional notes..."
          rows={3}
          className="w-full resize-none rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
        >
          {pending ? (
            <span className="flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {mode === "create" ? "Creating..." : "Saving..."}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {mode === "create" ? <Plus className="size-4" /> : <Save className="size-4" />}
              {mode === "create" ? "Add Asset" : "Save Changes"}
            </span>
          )}
        </Button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
