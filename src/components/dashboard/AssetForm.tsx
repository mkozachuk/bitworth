import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AssetRow } from "@/lib/database.types";
import type { Currency } from "@/lib/net-worth";

const CATEGORIES = [
  "Checking Account",
  "Savings Account",
  "Business/FOP Account",
  "Cash on Hand",
  "Stocks",
  "Investment Funds",
  "Bonds",
  "Crypto",
  "Precious Metals",
  "Real Estate",
  "Vehicles & Valuables",
  "Loans & Credit",
  "P2P/Loans Given",
] as const;

const CURRENCY_OPTIONS = [
  { value: "PLN", label: "PLN" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
];

const CATEGORY_OPTIONS = CATEGORIES.map((cat) => ({ value: cat, label: cat }));

export interface AssetFormData {
  name: string;
  amount: number;
  currency: Currency;
  category: string;
  is_liability: boolean;
}

interface AssetFormProps {
  initialAsset?: Partial<AssetRow>;
  onSubmit: (data: AssetFormData) => void;
  onCancel: () => void;
  loading?: boolean;
}

interface FormErrors {
  name?: string;
  amount?: string;
}

export function AssetForm({ initialAsset, onSubmit, onCancel, loading }: AssetFormProps) {
  const [name, setName] = useState(initialAsset?.name ?? "");
  const [amount, setAmount] = useState(initialAsset?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>((initialAsset?.currency ?? "PLN") as Currency);
  const [category, setCategory] = useState(initialAsset?.category ?? CATEGORIES[0]);
  const [isLiability, setIsLiability] = useState(initialAsset?.is_liability ?? false);
  const [errors, setErrors] = useState<FormErrors>({});

  function validate(): boolean {
    const newErrors: FormErrors = {};

    if (!name.trim()) {
      newErrors.name = "Name is required";
    }

    const amountNum = parseFloat(amount);
    if (!amount.trim() || isNaN(amountNum)) {
      newErrors.amount = "Amount is required";
    } else if (amountNum < 0) {
      newErrors.amount = "Amount must be 0 or greater";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!validate()) return;

    onSubmit({
      name: name.trim(),
      amount: parseFloat(amount),
      currency,
      category,
      is_liability: isLiability,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
        placeholder="e.g. ING savings"
        error={errors.name}
        disabled={loading}
        autoFocus
      />

      <Input
        label="Amount"
        type="number"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
        }}
        placeholder="0.00"
        error={errors.amount}
        disabled={loading}
      />

      <Select
        label="Currency"
        options={CURRENCY_OPTIONS}
        value={currency}
        onChange={(e) => {
          setCurrency(e.target.value as Currency);
        }}
        disabled={loading}
      />

      <Select
        label="Category"
        options={CATEGORY_OPTIONS}
        value={category}
        onChange={(e) => {
          setCategory(e.target.value);
        }}
        disabled={loading}
      />

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_liability"
          checked={isLiability}
          onChange={(e) => {
            setIsLiability(e.target.checked);
          }}
          disabled={loading}
          className="h-4 w-4 rounded border-white/20 bg-white/5 text-purple-500 focus:ring-purple-500/50"
        />
        <label htmlFor="is_liability" className="text-sm font-medium text-blue-100">
          This is a liability (debt/loan)
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-purple-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? "Saving..." : initialAsset?.name ? "Update Asset" : "Add Asset"}
        </button>
      </div>
    </form>
  );
}
