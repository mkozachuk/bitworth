import { useState } from "react";
import { InboxIcon, AlertCircle } from "lucide-react";
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
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          <AlertCircle className="size-4 shrink-0" />
          {deleteError}
        </div>
      )}
      <div className="mb-4 flex items-center gap-1 border-b border-zinc-200 dark:border-white/10">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setFilter(tab.key);
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              filter === tab.key
                ? "border-b-2 border-purple-600 text-zinc-900 dark:border-purple-400 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-white/50 dark:hover:text-white/80"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <InboxIcon className="mb-3 size-10 text-zinc-300 dark:text-white/20" />
          <p className="text-zinc-500 dark:text-white/50">
            {filter === "all" ? "No assets yet" : `No ${filter} found`}
          </p>
          <p className="mt-1 text-sm text-zinc-400 dark:text-white/30">
            {filter === "all" ? "Add your first asset to get started" : `No ${filter} in this category`}
          </p>
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs tracking-wider text-zinc-500 uppercase dark:text-white/40">
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
