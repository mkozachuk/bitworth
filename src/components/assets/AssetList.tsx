import { useState } from "react";
import { InboxIcon } from "lucide-react";
import { AssetRow } from "./AssetRow";
import type { Tables } from "@/lib/database.types";

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

  const filtered = assets.filter((a) => {
    if (filter === "assets") return !a.category.is_liability;
    if (filter === "liabilities") return a.category.is_liability;
    return true;
  });

  async function handleDelete(id: string) {
    if (!confirm("Delete this asset? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (res.ok) {
        window.location.reload();
      }
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
      <div className="mb-4 flex items-center gap-1 border-b border-white/10">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setFilter(tab.key);
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              filter === tab.key ? "border-b-2 border-purple-400 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <InboxIcon className="mb-3 size-10 text-white/20" />
          <p className="text-white/50">{filter === "all" ? "No assets yet" : `No ${filter} found`}</p>
          <p className="mt-1 text-sm text-white/30">
            {filter === "all" ? "Add your first asset to get started" : `No ${filter} in this category`}
          </p>
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs tracking-wider text-white/40 uppercase">
              <th className="pr-4 pb-3 font-medium">Name</th>
              <th className="pr-4 pb-3 font-medium">Amount</th>
              <th className="pr-4 pb-3 font-medium">Category</th>
              <th className="pb-3 font-medium">Actions</th>
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
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
