import type { CSSProperties } from "react";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CurrencyBadge } from "./CurrencyBadge";
import type { Tables } from "@/lib/database.types";
import { convertAmount, type Currency } from "@/lib/net-worth";
import { CategoryIcon } from "@/lib/category-icons";
import { assetSharePct } from "@/lib/allocation";

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };

interface Props {
  asset: AssetWithCategory;
  onDelete: (id: string) => void;
  displayCurrency: Currency;
  rates: Record<Currency, number>;
  totalAssets: number;
  editing: boolean;
}

export function AssetCard({ asset, onDelete, displayCurrency, rates, totalAssets, editing }: Props) {
  const converted = convertAmount(asset.amount, asset.currency as Currency, displayCurrency, rates);
  const sharePct = asset.category.is_liability ? null : assetSharePct(converted, totalAssets);
  const priceSymbol = asset.crypto_symbol ?? asset.metal_symbol;

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: asset.id,
    disabled: !editing,
  });

  // Only the handle below carries `listeners` / `touch-none`. The card body is
  // never a drag surface, so a vertical swipe anywhere else still scrolls the
  // page on iOS Safari and in the installed PWA.
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: "relative", zIndex: 1, opacity: 0.85 } : {}),
  };

  return (
    // py keeps intra-card spacing tighter than the ruled gap between cards, so
    // the actions row reads as part of THIS asset, not the next one.
    <li
      ref={setNodeRef}
      style={style}
      className="border-border active:bg-accent border-b py-4 transition-colors first:pt-1 last:border-0 last:pb-1"
    >
      <div className="flex items-baseline justify-between gap-2">
        {editing && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${asset.name}`}
            className="text-muted-foreground active:text-foreground -my-2 -ml-2 shrink-0 cursor-grab touch-none self-center p-2 active:cursor-grabbing"
          >
            <GripVertical className="size-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <span className="text-foreground min-w-0 truncate font-medium">{asset.name}</span>
          {asset.notes && <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">{asset.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
      </div>
      {priceSymbol ? (
        <p className="text-muted-foreground tnum mt-1 text-xs">
          ~
          {asset.quantity != null
            ? asset.quantity.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
            : asset.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
          {priceSymbol}
        </p>
      ) : (
        <p className="text-muted-foreground tnum mt-1 text-xs">
          {asset.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
          {asset.currency}
        </p>
      )}
      <div className="text-foreground/70 mt-2 flex items-center gap-1.5 text-sm">
        <CategoryIcon name={asset.category.icon} />
        <span>{asset.category.name}</span>
        {asset.category.is_liability && <span className="text-loss text-xs">(liability)</span>}
      </div>
      {sharePct != null && (
        <p className="text-muted-foreground tnum mt-1 text-xs">{sharePct.toFixed(1)}% of all assets</p>
      )}
      <div className="border-border mt-3 flex items-center gap-2 border-t pt-3">
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
    </li>
  );
}
