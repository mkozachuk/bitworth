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
        <label htmlFor="name" className="text-foreground/70 mb-1 block text-sm">
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
          className={`bg-card text-foreground placeholder:text-muted-foreground focus:border-primary w-full rounded-sm border px-3 py-2 transition-colors focus:outline-none ${
            errors.name ? "border-destructive" : "border-input"
          }`}
        />
        {errors.name && <p className="text-destructive mt-1 text-xs">{errors.name}</p>}
      </div>

      {!isPriced && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="amount" className="text-foreground/70 mb-1 block text-sm">
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
              className={`bg-card text-foreground placeholder:text-muted-foreground focus:border-primary tnum w-full rounded-sm border px-3 py-2 transition-colors focus:outline-none ${
                errors.amount ? "border-destructive" : "border-input"
              }`}
            />
            {errors.amount && <p className="text-destructive mt-1 text-xs">{errors.amount}</p>}
          </div>

          <div>
            <label htmlFor="currency" className="text-foreground/70 mb-1 block text-sm">
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
                className={`bg-card text-foreground focus:border-primary w-full appearance-none rounded-sm border px-3 py-2 pr-8 transition-colors focus:outline-none ${
                  errors.currency ? "border-destructive" : "border-input"
                }`}
              >
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="PLN">PLN — Polish Zloty</option>
              </select>
              <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
                ▼
              </span>
            </div>
            {errors.currency && <p className="text-destructive mt-1 text-xs">{errors.currency}</p>}
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
              Quantity <span className="text-muted-foreground">(e.g., 0.5 BTC)</span>
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
              Quantity <span className="text-muted-foreground">(troy ounces)</span>
            </>
          }
          priceEndpoint="/api/metal-price"
          symbolInput="metals"
          initialSymbol={asset ? (asset.metal_symbol ?? "") : ""}
          initialQuantity={asset ? (asset.quantity != null ? String(asset.quantity) : "") : ""}
        />
      )}

      <div>
        <label htmlFor="notes" className="text-foreground/70 mb-1 block text-sm">
          Notes <span className="text-muted-foreground">(optional)</span>
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
          className="border-input bg-card text-foreground placeholder:text-muted-foreground focus:border-primary w-full resize-none rounded-sm border px-3 py-2 transition-colors focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="show_on_chart" className="text-foreground/70 flex items-center gap-2 text-sm">
          <input
            id="show_on_chart"
            type="checkbox"
            checked={showOnChart}
            onChange={(e) => {
              setShowOnChart(e.target.checked);
            }}
            className="accent-primary size-4"
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
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 rounded-sm px-4 py-2 font-medium transition-colors disabled:opacity-50"
        >
          {pending ? (
            <span className="flex items-center gap-2">
              <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
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
            className="border-primary text-primary hover:bg-primary/8 rounded-sm border-[1.5px] px-4 py-2 text-sm transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
