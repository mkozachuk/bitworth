import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { AssetRow } from "@/lib/database.types";
import type { Currency } from "@/lib/net-worth";

interface AssetListProps {
  assets: AssetRow[];
  onEdit: (asset: AssetRow) => void;
  onDelete: (id: string) => void;
  loading?: boolean;
  readOnly?: boolean;
}

function formatCurrency(value: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function groupByCategory(assets: AssetRow[]): Record<string, AssetRow[]> {
  const groups: Record<string, AssetRow[]> = {};
  for (const asset of assets) {
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- groups[asset.category] is guaranteed non-null after ??= */
    (groups[asset.category] ??= []).push(asset);
  }
  return groups;
}

export function AssetList({ assets, onEdit, onDelete, loading, readOnly = false }: AssetListProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assets</CardTitle>
        </CardHeader>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg bg-white/5 py-3">
              <div className="h-4 w-1/3 rounded bg-white/10" />
              <div className="ml-auto h-4 w-20 rounded bg-white/10" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (assets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assets</CardTitle>
        </CardHeader>
        <p className="py-6 text-center text-sm text-white/40">No assets yet. Add your first asset above.</p>
      </Card>
    );
  }

  const grouped = groupByCategory(assets);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assets</CardTitle>
      </CardHeader>
      <div className="space-y-4">
        {Object.entries(grouped).map(([category, categoryAssets]) => (
          <div key={category}>
            <p className="mb-1 text-xs font-medium tracking-wider text-white/30 uppercase">{category}</p>
            <div className="space-y-1">
              {categoryAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm ${asset.is_liability ? "text-white/50 line-through" : "text-white"}`}
                    >
                      {asset.name}
                    </span>
                  </div>
                  <span className={`text-sm font-medium ${asset.is_liability ? "text-red-400/70" : "text-white/90"}`}>
                    {formatCurrency(asset.amount, asset.currency as Currency)}
                  </span>
                  {!readOnly && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onEdit(asset);
                        }}
                        className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                        aria-label={`Edit ${asset.name}`}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          <path d="m15 5 4 4" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete "${asset.name}"? This cannot be undone.`)) {
                            onDelete(asset.id);
                          }
                        }}
                        className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-red-400"
                        aria-label={`Delete ${asset.name}`}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          <line x1="10" x2="10" y1="11" y2="17" />
                          <line x1="14" x2="14" y1="11" y2="17" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
