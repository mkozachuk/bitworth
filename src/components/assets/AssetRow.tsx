import { Pencil, Trash2 } from "lucide-react";
import { CurrencyBadge } from "./CurrencyBadge";
import type { Tables } from "@/lib/database.types";
import { CategoryIcon } from "@/lib/category-icons";
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
  const priceSymbol = asset.crypto_symbol ?? asset.metal_symbol;

  return (
    <tr className="border-border border-b last:border-0">
      <td className="py-3 pr-4">
        <span className="text-foreground font-medium">{asset.name}</span>
        {asset.notes && <p className="text-muted-foreground mt-0.5 max-w-[200px] truncate text-xs">{asset.notes}</p>}
        {sharePct != null && (
          <p className="text-muted-foreground tnum mt-0.5 text-xs">{sharePct.toFixed(1)}% of all assets</p>
        )}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <span className={`tnum ${asset.category.is_liability ? "text-loss" : "text-foreground"}`}>
            {asset.category.is_liability ? "-" : ""}
            {converted.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </span>
          <CurrencyBadge
            currency={asset.currency as Currency}
            cryptoSymbol={asset.crypto_symbol}
            metalSymbol={asset.metal_symbol}
          />
        </div>
        {priceSymbol ? (
          <span className="text-muted-foreground tnum text-xs">
            ~
            {asset.quantity != null
              ? asset.quantity.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
              : asset.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {priceSymbol}
          </span>
        ) : (
          <span className="text-muted-foreground tnum text-xs">
            {asset.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {asset.currency}
          </span>
        )}
      </td>
      <td className="py-3 pr-4">
        <div className="text-foreground/70 flex items-center gap-1.5 text-sm">
          <CategoryIcon name={asset.category.icon} />
          <span>{asset.category.name}</span>
          {asset.category.is_liability && <span className="text-loss text-xs">(liability)</span>}
        </div>
      </td>
      <td className="py-3">
        <div className="flex items-center gap-2">
          <a
            href={`/dashboard/assets/${asset.id}/edit`}
            className="text-primary dark:text-foreground flex items-center gap-1 text-sm transition-colors hover:underline"
          >
            <Pencil className="size-3.5" />
            Edit
          </a>
          <span className="text-border">|</span>
          <button
            type="button"
            onClick={() => {
              onDelete(asset.id);
            }}
            className="text-destructive flex items-center gap-1 text-sm transition-colors hover:underline"
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
