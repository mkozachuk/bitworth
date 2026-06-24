import { Pencil, Trash2 } from "lucide-react";
import { CurrencyBadge } from "./CurrencyBadge";
import type { Tables } from "@/lib/database.types";
import { categoryEmoji } from "@/lib/category-icons";
import { convertAmount, type Currency } from "@/lib/net-worth";
import { assetSharePct } from "@/lib/allocation";

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };

interface Props {
  asset: AssetWithCategory;
  onDelete: (id: string) => void;
  displayCurrency: Currency;
  rates: Record<Currency, number>;
  totalAssets: number;
}

export function AssetRow({ asset, onDelete, displayCurrency, rates, totalAssets }: Props) {
  const converted = convertAmount(asset.amount, asset.currency as Currency, displayCurrency, rates);
  const sharePct = asset.category.is_liability ? null : assetSharePct(converted, totalAssets);

  return (
    <tr className="border-b border-zinc-200 last:border-0 dark:border-white/10">
      <td className="py-3 pr-4">
        <span className="font-medium text-zinc-900 dark:text-white">{asset.name}</span>
        {asset.notes && (
          <p className="mt-0.5 max-w-[200px] truncate text-xs text-zinc-500 dark:text-white/50">{asset.notes}</p>
        )}
        {sharePct != null && (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-white/40">{sharePct.toFixed(1)}% of all assets</p>
        )}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <span
            className={asset.category.is_liability ? "text-red-600 dark:text-red-300" : "text-zinc-900 dark:text-white"}
          >
            {asset.category.is_liability ? "-" : ""}
            {converted.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </span>
          <CurrencyBadge currency={asset.currency as Currency} cryptoSymbol={asset.crypto_symbol} />
        </div>
        {asset.category_id === "crypto" && asset.crypto_symbol ? (
          <span className="text-xs text-zinc-500 dark:text-white/40">
            ~
            {asset.quantity != null
              ? asset.quantity.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
              : asset.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {asset.crypto_symbol}
          </span>
        ) : (
          <span className="text-xs text-zinc-500 dark:text-white/40">
            {asset.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {asset.currency}
          </span>
        )}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-white/70">
          {categoryEmoji(asset.category.icon) && <span>{categoryEmoji(asset.category.icon)}</span>}
          <span>{asset.category.name}</span>
          {asset.category.is_liability && <span className="text-xs text-red-600 dark:text-red-300">(liability)</span>}
        </div>
      </td>
      <td className="py-3">
        <div className="flex items-center gap-2">
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
      </td>
    </tr>
  );
}
