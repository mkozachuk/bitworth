import { useState } from "react";
import { InboxIcon, AlertCircle, Pencil, Check } from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AssetRow } from "./AssetRow";
import { AssetCard } from "./AssetCard";
import type { Tables } from "@/lib/database.types";
import { totalAssetPool } from "@/lib/allocation";
import { moveId } from "@/lib/asset-order";

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
  // One banner for every list-level failure (delete and reorder alike) — the
  // plan deliberately reuses this instead of introducing a toast system.
  const [listError, setListError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // The list the user sees while dragging. Seeded from the prop and only ever
  // replaced wholesale, so the optimistic update can be reverted by restoring
  // the array captured before the drop.
  const [ordered, setOrdered] = useState<AssetWithCategory[]>(assets);
  const [savingOrder, setSavingOrder] = useState(false);

  // A few pixels of travel before a drag starts, so a tap on the handle stays a
  // tap and does not swallow the click.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Shared denominator for the per-row "% of all assets" sub-label: sum of
  // positive non-liability converted values, computed once over the full set.
  const totalAssets = totalAssetPool(
    ordered.map((a) => ({ amount: a.amount, currency: a.currency, is_liability: a.category.is_liability })),
    displayCurrency,
    rates,
  );

  const filtered = ordered.filter((a) => {
    if (filter === "assets") return !a.category.is_liability;
    if (filter === "liabilities") return a.category.is_liability;
    return true;
  });

  async function handleDelete(id: string) {
    if (!confirm("Delete this asset? This cannot be undone.")) return;
    setDeletingId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (res.ok) {
        window.location.reload();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Response.json() is typed as Promise<any> in the Fetch standard library
        const json: { error?: { message?: string } } = await res.json();
        setListError(json.error?.message ?? "Delete failed");
      }
    } catch {
      setListError("Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    // A save is already in flight — ignore this drop rather than racing two
    // renumbers whose revert arrays would desynchronize.
    if (savingOrder) return;
    if (!over || active.id === over.id) return;

    // Captured BEFORE the optimistic update: the revert is a restore of this
    // exact array, never a recomputed inverse move.
    const previous = ordered;
    const nextIds = moveId(
      previous.map((a) => a.id),
      String(active.id),
      String(over.id),
    );
    const byId = new Map(previous.map((a) => [a.id, a]));
    const next = nextIds.flatMap((id) => {
      const asset = byId.get(id);
      return asset ? [asset] : [];
    });

    setOrdered(next);
    setSavingOrder(true);
    setListError(null);
    try {
      const res = await fetch("/api/assets/order", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: nextIds }),
      });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Response.json() is typed as Promise<any> in the Fetch standard library
        const json: { error?: { message?: string } } = await res.json();
        setOrdered(previous);
        setListError(json.error?.message ?? "Reorder failed");
      }
    } catch {
      setOrdered(previous);
      setListError("Reorder failed");
    } finally {
      setSavingOrder(false);
    }
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "assets", label: "Assets" },
    { key: "liabilities", label: "Liabilities" },
  ];

  // Reordering writes the caller's FULL id array, so it is only coherent on the
  // All tab — a filtered list would send a partial cover and the RPC would (by
  // design) reject it.
  const canReorder = filter === "all";
  const sortableIds = filtered.map((a) => a.id);

  const desktopList = (
    <div className="hidden sm:block">
      <table className="w-full">
        <thead>
          <tr className="text-foreground/60 text-left text-xs tracking-[0.12em] uppercase">
            {editing && (
              <th className="w-8 pr-2 pb-3 font-bold">
                <span className="sr-only">Reorder</span>
              </th>
            )}
            <th className="pr-4 pb-3 font-bold">Name</th>
            <th className="pr-4 pb-3 font-bold">Amount</th>
            <th className="pr-4 pb-3 font-bold">Category</th>
            <th className="pb-3 font-bold">Actions</th>
          </tr>
        </thead>
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          <tbody>
            {filtered.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                onDelete={handleDelete}
                displayCurrency={displayCurrency}
                rates={rates}
                totalAssets={totalAssets}
                editing={editing}
              />
            ))}
          </tbody>
        </SortableContext>
      </table>
    </div>
  );

  const mobileList = (
    <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
      <ul role="list" className="sm:hidden">
        {filtered.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            onDelete={handleDelete}
            displayCurrency={displayCurrency}
            rates={rates}
            totalAssets={totalAssets}
            editing={editing}
          />
        ))}
      </ul>
    </SortableContext>
  );

  return (
    <div>
      {listError && (
        <div className="border-destructive text-destructive mb-4 flex items-center gap-2 rounded-sm border px-4 py-2 text-sm">
          <AlertCircle className="size-4 shrink-0" />
          {listError}
        </div>
      )}
      <div className="border-border mb-4 flex items-center gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setFilter(tab.key);
              // Leaving the All tab leaves edit mode with it.
              if (tab.key !== "all") setEditing(false);
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
        <button
          type="button"
          onClick={() => {
            setEditing((v) => !v);
          }}
          disabled={!canReorder}
          title={canReorder ? (editing ? "Done" : "Edit list") : "Reordering is available on the All tab"}
          // Icon-only at every breakpoint, so the accessible name has to be
          // spelled out — there is no visible text for it to come from.
          aria-label={editing ? "Done" : "Edit list"}
          className={`ml-auto flex items-center px-3 py-2 transition-colors ${
            editing ? "text-primary dark:text-foreground" : "text-foreground/60 hover:text-foreground"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {editing ? <Check className="size-4" /> : <Pencil className="size-4" />}
        </button>
      </div>

      {!canReorder && (
        <p className="text-muted-foreground -mt-2 mb-4 text-xs">Switch to the All tab to reorder your list.</p>
      )}

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
          {/* One DndContext per rendering. Both lists are mounted at all times
              (only CSS hides one), and a single context would see each asset id
              registered twice. Separate contexts keep the two registries apart.
              The context sits OUTSIDE the table so its hidden live region is not
              an invalid child of <table>. */}
          {editing ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              {desktopList}
            </DndContext>
          ) : (
            desktopList
          )}
          {editing ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              {mobileList}
            </DndContext>
          ) : (
            mobileList
          )}
        </>
      )}
    </div>
  );
}
