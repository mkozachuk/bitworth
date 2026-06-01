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

export function AssetRow({ asset, onDelete, displayCurrency, rates }: Props) {
  const converted = convertAmount(asset.amount, asset.currency as Currency, displayCurrency, rates);

  return (
    <tr className="border-b border-white/10 last:border-0">
      <td className="py-3 pr-4">
        <span className="font-medium text-white">{asset.name}</span>
        {asset.notes && <p className="mt-0.5 max-w-[200px] truncate text-xs text-white/50">{asset.notes}</p>}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <span className={asset.category.is_liability ? "text-red-300" : "text-white"}>
            {asset.category.is_liability ? "-" : ""}
            {converted.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </span>
          <CurrencyBadge currency={asset.currency as "USD" | "EUR" | "PLN"} cryptoSymbol={asset.crypto_symbol} />
        </div>
        {asset.category_id === "crypto" && asset.crypto_symbol ? (
          <span className="text-xs text-white/40">
            ~
            {asset.quantity != null
              ? asset.quantity.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
              : asset.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {asset.crypto_symbol}
          </span>
        ) : (
          <span className="text-xs text-white/40">
            {asset.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {asset.currency}
          </span>
        )}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-1.5 text-sm text-white/70">
          {asset.category.icon && <span>{asset.category.icon}</span>}
          <span>{asset.category.name}</span>
          {asset.category.is_liability && <span className="text-xs text-red-300">(liability)</span>}
        </div>
      </td>
      <td className="py-3">
        <div className="flex items-center gap-2">
          <a
            href={`/dashboard/assets/${asset.id}/edit`}
            className="flex items-center gap-1 text-sm text-purple-300 transition-colors hover:text-purple-200"
          >
            <Pencil className="size-3.5" />
            Edit
          </a>
          <span className="text-white/20">|</span>
          <button
            type="button"
            onClick={() => {
              onDelete(asset.id);
            }}
            className="flex items-center gap-1 text-sm text-red-300 transition-colors hover:text-red-200"
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
