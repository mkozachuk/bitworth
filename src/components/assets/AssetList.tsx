import { useState } from "react";
import { InboxIcon, AlertCircle } from "lucide-react";
import { AssetRow } from "./AssetRow";
import { AssetCard } from "./AssetCard";
import type { Tables } from "@/lib/database.types";
import { totalAssetPool } from "@/lib/allocation";

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };
type Currency = "USD" | "EUR" | "PLN";

type FilterTab = "all" | "assets" | "liabilities";

interface Props {
  assets: AssetWithCategory[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

export function AssetList({ assets, displayCurrency, rates }: Props) {
  const [filter, setFilter] = useState<FilterTab>("all");
  const [_deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Shared denominator for the per-row "% of all assets" sub-label: sum of
  // positive non-liability converted values, computed once over the full set.
  const totalAssets = totalAssetPool(
    assets.map((a) => ({ amount: a.amount, currency: a.currency, is_liability: a.category.is_liability })),
    displayCurrency,
    rates,
  );

  const filtered = assets.filter((a) => {
    if (filter === "assets") return !a.category.is_liability;
    if (filter === "liabilities") return a.category.is_liability;
    return true;
  });

  async function handleDelete(id: string) {
    if (!confirm("Delete this asset? This cannot be undone.")) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (res.ok) {
        window.location.reload();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Response.json() is typed as Promise<any> in the Fetch standard library
        const json: { error?: { message?: string } } = await res.json();
        setDeleteError(json.error?.message ?? "Delete failed");
      }
    } catch {
      setDeleteError("Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "assets", label: "Assets" },
    { key: "liabilities", label: "Liabilities" },
  ];

  return (
    <div>
      {deleteError && (
        <div className="border-destructive text-destructive mb-4 flex items-center gap-2 rounded-sm border px-4 py-2 text-sm">
          <AlertCircle className="size-4 shrink-0" />
          {deleteError}
        </div>
      )}
      <div className="border-border mb-4 flex items-center gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setFilter(tab.key);
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              filter === tab.key
                ? "border-primary text-foreground border-b-2"
                : "text-foreground/60 hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="border-kraft flex flex-col items-center justify-center rounded-md border-2 border-dashed py-16 text-center">
          <InboxIcon className="text-ink-faint mb-3 size-10" />
          <p className="text-foreground/70">{filter === "all" ? "No assets yet" : `No ${filter} found`}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {filter === "all" ? "Add your first asset to get started" : `No ${filter} in this category`}
          </p>
        </div>
      ) : (
        <>
          <div className="hidden sm:block">
            <table className="w-full">
              <thead>
                <tr className="text-foreground/60 text-left text-xs tracking-[0.12em] uppercase">
                  <th className="pr-4 pb-3 font-bold">Name</th>
                  <th className="pr-4 pb-3 font-bold">Amount</th>
                  <th className="pr-4 pb-3 font-bold">Category</th>
                  <th className="pb-3 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((asset) => (
                  <AssetRow
                    key={asset.id}
                    asset={asset}
                    onDelete={handleDelete}
                    displayCurrency={displayCurrency}
                    rates={rates}
                    totalAssets={totalAssets}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <ul role="list" className="sm:hidden">
            {filtered.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onDelete={handleDelete}
                displayCurrency={displayCurrency}
                rates={rates}
                totalAssets={totalAssets}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
