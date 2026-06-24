import { useState } from "react";
import { Save, Plus, Minus } from "lucide-react";
import { PieChart, Pie, Legend, Tooltip, ResponsiveContainer } from "recharts";
import { ServerError } from "@/components/auth/ServerError";
import { computeAllocation, type AllocationSlice } from "@/lib/allocation";
import type { Currency } from "@/lib/net-worth";

// One selectable non-liability asset, pre-shaped server-side. Raw amount +
// currency (not a pre-converted value) so the island can re-run the SAME
// `computeAllocation` code path as the server — one denominator, one slice
// order, one color map across both pies.
interface BalancerAsset {
  asset_id: string;
  name: string;
  amount: number;
  currency: string;
}

interface Props {
  assets: BalancerAsset[];
  savedTargets: Record<string, number>; // asset_id -> saved target_pct (0–100)
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

// Both pies cycle the same five chart variables; slice i shares one color
// across declared + real because both iterate the same ordered slice list.
const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const colorFor = (index: number): string => CHART_COLORS[index % CHART_COLORS.length];

// Empty target box is held as NaN so the field can be cleared and retyped
// without snapping to 0; num() coerces NaN/undefined to 0 where consumed.
const num = (value: number | undefined): number => (value === undefined || Number.isNaN(value) ? 0 : value);

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { name?: string; value?: number }[] }) {
  if (active && payload?.length) {
    const slice = payload[0];
    return (
      <div className="rounded-lg border border-zinc-200 bg-white/95 p-3 text-zinc-900 backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white">
        <p className="text-sm font-semibold">
          {slice.name}: {(slice.value ?? 0).toFixed(1)}%
        </p>
      </div>
    );
  }
  return null;
}

// Each datum carries its own `fill` (indexed by slice order) — the recommended
// recharts v3 path now that <Cell> is deprecated. Both pies build their data
// from the same ordered slice list, so slice i is the same color in both.
interface PieDatum {
  name: string;
  pct: number;
  fill: string;
}

function AllocationPie({
  title,
  slices,
  mode,
}: {
  title: string;
  slices: AllocationSlice[];
  mode: "declared" | "real";
}) {
  const data: PieDatum[] = slices.map((s, index) => ({
    name: s.name,
    pct: mode === "declared" ? s.targetPct : (s.realPct ?? 0),
    fill: colorFor(index),
  }));

  return (
    <div>
      <h3 className="mb-4 text-center text-sm font-medium tracking-wider text-zinc-600 uppercase dark:text-white/60">
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={280} initialDimension={{ width: 400, height: 280 }}>
        <PieChart>
          <Pie
            data={data}
            dataKey="pct"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={85}
            innerRadius={42}
            isAnimationActive={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value: string) => <span className="text-zinc-600 dark:text-white/60">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BalancerView({ assets, savedTargets, displayCurrency, rates }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(Object.keys(savedTargets)));
  // A selected asset with no saved target has no key here, so the value is
  // genuinely `number | undefined` at runtime; num() coerces the gap to 0.
  const [targets, setTargets] = useState<Record<string, number | undefined>>(() => ({ ...savedTargets }));
  // The asset currently chosen in the "add" dropdown, before the + button
  // commits it to the selected set. "" means nothing picked.
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function addPicked() {
    if (!pick) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.add(pick);
      return next;
    });
    setPick("");
  }

  function removeAsset(assetId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(assetId);
      return next;
    });
  }

  function updateTarget(assetId: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setTargets((prev) => ({ ...prev, [assetId]: e.target.valueAsNumber }));
    };
  }

  // Build the allocation input in the assets' display order (so color mapping
  // is stable), filtered to the selected set. One shared computeAllocation call
  // feeds both pies and the live sum flag.
  const allocationInput = assets
    .filter((a) => selected.has(a.asset_id))
    .map((a) => ({
      asset_id: a.asset_id,
      name: a.name,
      amount: a.amount,
      currency: a.currency,
      targetPct: num(targets[a.asset_id]),
    }));

  const result = computeAllocation(allocationInput, displayCurrency, rates);
  const hasSelection = result.slices.length > 0;
  const sumOffBy100 = hasSelection && Math.abs(result.declaredSum - 100) > 0.01;

  // Assets not yet in the set populate the add dropdown; selected assets (kept
  // in display order so the per-asset colors stay stable) populate the
  // configurable list below it.
  const available = assets.filter((a) => !selected.has(a.asset_id));
  const selectedAssets = assets.filter((a) => selected.has(a.asset_id));

  async function handleSave() {
    setError(null);
    setPending(true);

    const payload = assets
      .filter((a) => selected.has(a.asset_id))
      .map((a) => ({ asset_id: a.asset_id, target_pct: num(targets[a.asset_id]) }));

    try {
      const res = await fetch("/api/allocation-targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: { message: string } };

      if (json.error) {
        setError(json.error.message);
        setPending(false);
        return;
      }

      window.location.reload();
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  if (assets.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white/80 p-8 text-center dark:border-white/10 dark:bg-white/5">
        <p className="text-sm text-zinc-600 dark:text-white/60">
          You have no assets yet. Add some assets first, then come back to set your target allocation.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="rounded-2xl border border-zinc-200 bg-white/80 p-6 lg:col-span-1 dark:border-white/10 dark:bg-white/5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-wider text-zinc-600 uppercase dark:text-white/60">
            Select assets &amp; targets
          </h2>
          <span
            className={
              sumOffBy100
                ? "text-xs font-medium text-amber-600 dark:text-amber-400"
                : "text-xs text-zinc-500 dark:text-white/40"
            }
          >
            Targets sum = {result.declaredSum.toFixed(1)}%
          </span>
        </div>

        {/* Add control: single-choice dropdown of not-yet-selected assets + a
            "+" button that commits the pick to the set. */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <select
              aria-label="Choose an asset to add"
              value={pick}
              onChange={(e) => {
                setPick(e.target.value);
              }}
              disabled={available.length === 0}
              className="w-full appearance-none rounded-lg border border-zinc-300 bg-white px-3 py-2 pr-8 text-sm text-zinc-900 transition-colors focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-white/10 dark:text-white"
            >
              <option value="">{available.length === 0 ? "All assets added" : "Add an asset…"}</option>
              {available.map((asset) => (
                <option key={asset.asset_id} value={asset.asset_id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={addPicked}
            disabled={!pick}
            aria-label="Add selected asset"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-purple-600 text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="size-4" />
          </button>
        </div>

        {/* Configurable list: one row per selected asset with its target input
            and a "−" button to remove it from the set. */}
        {selectedAssets.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500 dark:text-white/40">
            No assets selected yet. Add one above to set its target.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {selectedAssets.map((asset) => {
              const target = targets[asset.asset_id];
              return (
                <div
                  key={asset.asset_id}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-white/10"
                >
                  <span className="flex-1 truncate text-sm text-zinc-900 dark:text-white">{asset.name}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    aria-label={`Target percentage for ${asset.name}`}
                    value={target === undefined || Number.isNaN(target) ? "" : target}
                    onChange={updateTarget(asset.asset_id)}
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="0"
                    className="w-20 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-right text-sm text-zinc-900 transition-colors focus:ring-2 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white"
                  />
                  <span className="text-sm text-zinc-500 dark:text-white/40">%</span>
                  <button
                    type="button"
                    onClick={() => {
                      removeAsset(asset.asset_id);
                    }}
                    aria-label={`Remove ${asset.name}`}
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-zinc-500 transition-colors hover:border-red-300 hover:text-red-600 dark:border-white/20 dark:text-white/50 dark:hover:border-red-400/40 dark:hover:text-red-300"
                  >
                    <Minus className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {sumOffBy100 && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            Your targets don&apos;t add up to 100%. You can still save — the declared pie shows your raw percentages.
          </p>
        )}

        <ServerError message={error} />

        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="mt-4 flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Saving...
            </>
          ) : (
            <>
              <Save className="size-4" />
              Save
            </>
          )}
        </button>
      </div>

      {/* Both pies share one card: side by side on desktop, stacked on mobile. */}
      <div className="rounded-2xl border border-zinc-200 bg-white/80 p-6 lg:col-span-2 dark:border-white/10 dark:bg-white/5">
        {hasSelection ? (
          <div className="grid gap-6 md:grid-cols-2">
            <AllocationPie title="Declared (target %)" slices={result.slices} mode="declared" />
            <AllocationPie title="Real (current value)" slices={result.slices} mode="real" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center py-12 text-center">
            <p className="text-sm text-zinc-600 dark:text-white/60">
              Add one or more assets to compare your declared targets against their real current-value allocation.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
