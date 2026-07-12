import { useState } from "react";
import { Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";
import { CategorySelect } from "./CategorySelect";
import { PricedQuantityFields } from "./PricedQuantityFields";
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
  const [showOnChart, setShowOnChart] = useState(asset?.show_on_chart ?? false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);

  const isPriced = categoryId === "crypto" || categoryId === "precious_metals";

  function validate(): boolean {
    const next: FormErrors = {};
    if (!name.trim()) {
      next.name = "Name is required";
    }
    // For priced categories, amount is auto-calculated from quantity × price — skip validation
    if (!isPriced) {
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
        <label htmlFor="name" className="mb-1 block text-sm text-zinc-700 dark:text-blue-100/80">
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
          className="w-full rounded-lg border bg-white px-3 py-2 text-zinc-900 placeholder-zinc-500 transition-colors focus:ring-2 focus:outline-none dark:bg-white/10 dark:text-white dark:placeholder-white/40"
          style={
            errors.name
              ? { borderColor: "rgb(148 163 184 / 0.6)", boxShadow: "0 0 0 2px rgba(248,113,113,0.4)" }
              : { borderColor: "rgb(212 212 216)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }
          }
        />
        {errors.name && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{errors.name}</p>}
      </div>

      {!isPriced && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="amount" className="mb-1 block text-sm text-zinc-700 dark:text-blue-100/80">
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
              className="w-full rounded-lg border bg-white px-3 py-2 text-zinc-900 placeholder-zinc-500 transition-colors focus:ring-2 focus:outline-none dark:bg-white/10 dark:text-white dark:placeholder-white/40"
              style={
                errors.amount
                  ? { borderColor: "rgb(148 163 184 / 0.6)", boxShadow: "0 0 0 2px rgba(248,113,113,0.4)" }
                  : { borderColor: "rgb(212 212 216)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }
              }
            />
            {errors.amount && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{errors.amount}</p>}
          </div>

          <div>
            <label htmlFor="currency" className="mb-1 block text-sm text-zinc-700 dark:text-blue-100/80">
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
                className="w-full appearance-none rounded-lg border bg-white px-3 py-2 pr-8 text-zinc-900 transition-colors focus:ring-2 focus:outline-none dark:bg-white/10 dark:text-white"
                style={
                  errors.currency
                    ? { borderColor: "rgb(148 163 184 / 0.6)", boxShadow: "0 0 0 2px rgba(248,113,113,0.4)" }
                    : { borderColor: "rgb(212 212 216)", boxShadow: "0 0 0 2px rgba(192,132,252,0.4)" }
                }
              >
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="PLN">PLN — Polish Zloty</option>
              </select>
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-zinc-500 dark:text-white/40">
                ▼
              </span>
            </div>
            {errors.currency && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{errors.currency}</p>}
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
        <PricedQuantityFields
          symbolFieldName="crypto_symbol"
          quantityLabel={
            <>
              Quantity <span className="text-zinc-500 dark:text-white/40">(e.g., 0.5 BTC)</span>
            </>
          }
          priceEndpoint="/api/crypto-price"
          symbolInput="crypto"
          initialSymbol={asset ? (asset.crypto_symbol ?? "") : ""}
          initialQuantity={asset ? (asset.quantity != null ? String(asset.quantity) : "") : ""}
        />
      )}

      {categoryId === "precious_metals" && (
        <PricedQuantityFields
          symbolFieldName="metal_symbol"
          quantityLabel={
            <>
              Quantity <span className="text-zinc-500 dark:text-white/40">(troy ounces)</span>
            </>
          }
          priceEndpoint="/api/metal-price"
          symbolInput="metals"
          initialSymbol={asset ? (asset.metal_symbol ?? "") : ""}
          initialQuantity={asset ? (asset.quantity != null ? String(asset.quantity) : "") : ""}
        />
      )}

      <div>
        <label htmlFor="notes" className="mb-1 block text-sm text-zinc-700 dark:text-blue-100/80">
          Notes <span className="text-zinc-500 dark:text-white/40">(optional)</span>
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
          className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder-zinc-500 transition-colors focus:ring-2 focus:ring-purple-500 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder-white/40"
        />
      </div>

      <div>
        <label htmlFor="show_on_chart" className="flex items-center gap-2 text-sm text-zinc-700 dark:text-blue-100/80">
          <input
            id="show_on_chart"
            type="checkbox"
            checked={showOnChart}
            onChange={(e) => {
              setShowOnChart(e.target.checked);
            }}
            className="size-4 accent-purple-600"
          />
          Show on chart
        </label>
        {/* Native unchecked checkboxes are absent from FormData — mirror the
            controlled state into a hidden input so PUT can detect "unchecked". */}
        <input type="hidden" name="show_on_chart" value={showOnChart ? "true" : "false"} />
      </div>

      <div className="flex flex-col gap-3 pt-2 sm:flex-row">
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
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-white/20 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
