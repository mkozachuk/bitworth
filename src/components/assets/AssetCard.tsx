import { Pencil, Trash2 } from "lucide-react";
import { CurrencyBadge } from "./CurrencyBadge";
import type { Tables } from "@/lib/database.types";
import { convertAmount, type Currency } from "@/lib/net-worth";

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };

interface Props {
  asset: AssetWithCategory;
  onDelete: (id: string) => void;
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

export function AssetCard({ asset, onDelete, displayCurrency, rates }: Props) {
  const converted = convertAmount(asset.amount, asset.currency as Currency, displayCurrency, rates);

  return (
    <li className="border-b border-zinc-200 transition-colors last:border-0 active:bg-zinc-50 dark:border-white/10 dark:active:bg-white/5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="min-w-0 truncate font-medium text-zinc-900 dark:text-white">{asset.name}</span>
          {asset.notes && <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 dark:text-white/50">{asset.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`tabular-nums ${asset.category.is_liability ? "text-red-600 dark:text-red-300" : "text-zinc-900 dark:text-white"}`}
          >
            {asset.category.is_liability ? "-" : ""}
            {converted.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </span>
          <CurrencyBadge currency={asset.currency as Currency} cryptoSymbol={asset.crypto_symbol} />
        </div>
      </div>
      {asset.category_id === "crypto" && asset.crypto_symbol ? (
        <p className="mt-1 text-xs text-zinc-500 tabular-nums dark:text-white/40">
          ~
          {asset.quantity != null
            ? asset.quantity.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
            : asset.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
          {asset.crypto_symbol}
        </p>
      ) : (
        <p className="mt-1 text-xs text-zinc-500 tabular-nums dark:text-white/40">
          {asset.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
          {asset.currency}
        </p>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-sm text-zinc-700 dark:text-white/70">
        {asset.category.icon && <span>{asset.category.icon}</span>}
        <span>{asset.category.name}</span>
        {asset.category.is_liability && <span className="text-xs text-red-600 dark:text-red-300">(liability)</span>}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-zinc-200 pt-3 dark:border-white/10">
        <a
          href={`/dashboard/assets/${asset.id}/edit`}
          className="flex items-center gap-1 text-sm text-purple-600 transition-colors hover:text-purple-800 dark:text-purple-300 dark:hover:text-purple-200"
        >
          <Pencil className="size-3.5" />
          Edit
        </a>
        <span className="text-zinc-300 dark:text-white/20">|</span>
        <button
          type="button"
          onClick={() => {
            onDelete(asset.id);
          }}
          className="flex items-center gap-1 text-sm text-red-600 transition-colors hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
        >
          <Trash2 className="size-3.5" />
          Delete
        </button>
      </div>
    </li>
  );
}
