/* eslint-disable @typescript-eslint/no-redundant-type-constituents -- Supabase-generated Database types use 'error' types that are intentional */
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { NetWorthCard } from "@/components/dashboard/NetWorthCard";
import { AssetList } from "@/components/dashboard/AssetList";
import { AssetForm, type AssetFormData } from "@/components/dashboard/AssetForm";
import { NetWorthChart } from "@/components/dashboard/NetWorthChart";
import { CurrencySelector } from "@/components/dashboard/CurrencySelector";
import { SnapshotButton } from "@/components/dashboard/SnapshotButton";
import { AuthStatus } from "@/components/auth/AuthStatus";
import { computeNetWorth, type Currency } from "@/lib/net-worth";
import { computeDelta, getLastMonthSnapshot, getYearStartSnapshot } from "@/lib/delta";
import type { AssetRow } from "@/lib/database.types";
import type { SnapshotRow } from "@/lib/database.types";
import type { ExchangeRate } from "@/lib/exchange-rates";

interface DashboardClientProps {
  profile: { display_currency: string };
  assets: AssetRow[];
  snapshots: SnapshotRow[];
  rates: ExchangeRate[];
  isDemo?: boolean;
}

export function DashboardClient({ profile, assets, snapshots, rates, isDemo = false }: DashboardClientProps) {
  const displayCurrency = profile.display_currency as Currency;

  const [assetList, setAssetList] = useState<AssetRow[]>(assets);
  const [snapshotList, setSnapshotList] = useState<SnapshotRow[]>(snapshots);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetRow | null>(null);

  const netWorth = computeNetWorth(assetList, rates, displayCurrency);

  const lastMonth = getLastMonthSnapshot(snapshotList);
  const jan1 = getYearStartSnapshot(snapshotList);

  const sortedSnapshots = [...snapshotList].sort(
    (a, b) => new Date(b.snapshot_date).getTime() - new Date(a.snapshot_date).getTime(),
  );
  const latestSnapshot = sortedSnapshots[0] ?? null;

  const deltaMonth = lastMonth && latestSnapshot ? computeDelta(lastMonth, latestSnapshot) : null;
  const deltaYear = jan1 && latestSnapshot ? computeDelta(jan1, latestSnapshot) : null;

  async function handleAddAsset(data: AssetFormData) {
    setLoading(true);
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create asset");
      const json = (await res.json()) as { data: AssetRow };
      setAssetList((prev) => [json.data, ...prev]);
      setFormOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleEditAsset(data: AssetFormData) {
    if (!editingAsset) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/assets/${editingAsset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update asset");
      const json = (await res.json()) as { data: AssetRow };
      setAssetList((prev) => prev.map((a) => (a.id === editingAsset.id ? json.data : a)));
      setEditingAsset(null);
      setFormOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAsset(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete asset");
      setAssetList((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSnapshot() {
    const res = await fetch("/api/snapshots", { method: "POST" });
    if (!res.ok) throw new Error("Failed to save snapshot");
    const json = (await res.json()) as { data: SnapshotRow };
    setSnapshotList((prev) => [...prev, json.data]);
  }

  function handleCurrencyChange(_currency: Currency) {
    // Refresh data after currency change so net worth recalculates
    fetch("/api/snapshots")
      .then((r) => r.json())
      .then((json) => {
        const data = json.data as SnapshotRow[];
        setSnapshotList(data.length > 0 ? data : snapshotList);
      })

      .catch(() => {
        console.error("Failed to refresh snapshots after currency change");
      });
  }

  function openAddForm() {
    setEditingAsset(null);
    setFormOpen(true);
  }

  function openEditForm(asset: AssetRow) {
    setEditingAsset(asset);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingAsset(null);
  }

  return (
    <div className="space-y-6">
      {isDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-300">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          Demo mode — data is read-only
        </div>
      )}

      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">{isDemo ? "Demo Dashboard" : "Dashboard"}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <CurrencySelector value={displayCurrency} onChange={handleCurrencyChange} />
          {!isDemo && <SnapshotButton onSave={handleSaveSnapshot} />}
          {isDemo ? (
            <span className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm text-white/60">
              Demo User
            </span>
          ) : (
            <AuthStatus email="" currency={displayCurrency} onCurrencyChange={handleCurrencyChange} />
          )}
        </div>
      </div>

      {/* Top row: net worth + chart */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <NetWorthCard total={netWorth.total} currency={displayCurrency} deltaMonth={deltaMonth} deltaYear={deltaYear} />
        <NetWorthChart snapshots={snapshotList} currency={displayCurrency} />
      </div>

      {/* Add asset button + asset list */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Your Assets</h2>
          {!isDemo && (
            <button
              type="button"
              onClick={openAddForm}
              className="flex items-center gap-2 rounded-lg bg-purple-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-600"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              Add Asset
            </button>
          )}
        </div>
        <AssetList
          assets={assetList}
          onEdit={openEditForm}
          onDelete={handleDeleteAsset}
          loading={loading}
          readOnly={isDemo}
        />
      </div>

      {/* Asset form modal */}
      <Modal open={formOpen} onClose={closeForm} title={editingAsset ? "Edit Asset" : "Add Asset"}>
        <AssetForm
          initialAsset={editingAsset ?? undefined}
          onSubmit={editingAsset ? handleEditAsset : handleAddAsset}
          onCancel={closeForm}
          loading={loading}
        />
      </Modal>
    </div>
  );
}
