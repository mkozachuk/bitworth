import { useState } from "react";
import { Save, Plus, Minus, Wallet, Trash2 } from "lucide-react";
import { PieChart, Pie, Legend, Tooltip, ResponsiveContainer } from "recharts";
import { ServerError } from "@/components/auth/ServerError";
import { computeAllocation, computeBuyPlan, type AllocationSlice } from "@/lib/allocation";
import { convertAmount, type Currency } from "@/lib/net-worth";

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

// One portfolio card: a named, independent target set. The same asset may live
// in several cards with different targets (e.g. an "ETFs" card and a
// "Bonds & funds" card), so `targets` is this card's own asset_id -> pct map.
interface CardData {
  id: string;
  name: string;
  position: number;
  targets: Record<string, number>; // asset_id -> saved target_pct (0–100)
}

interface Props {
  assets: BalancerAsset[];
  cards: CardData[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}

// Both pies cycle five categorical inks (vermilion excluded — it is the seal
// and loss color, never a category); slice i shares one color
// across declared + real because both iterate the same ordered slice list.
const CHART_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--kraft)"];
const colorFor = (index: number): string => CHART_COLORS[index % CHART_COLORS.length];

// Currencies the buy-plan budget can be entered in. Mirrors the `Currency` union
// (exchange-rates.ts) — USD first to match the system default ordering.
const CURRENCIES: Currency[] = ["USD", "EUR", "PLN"];

// Empty target box is held as NaN so the field can be cleared and retyped
// without snapping to 0; num() coerces NaN/undefined to 0 where consumed.
const num = (value: number | undefined): number => (value === undefined || Number.isNaN(value) ? 0 : value);

// Money in the display currency: two decimals + the currency code, matching the
// inline `toLocaleString("en-US", …)` convention used across the asset cards.
const money = (value: number, currency: Currency): string =>
  `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { name?: string; value?: number }[] }) {
  if (active && payload?.length) {
    const slice = payload[0];
    return (
      <div className="border-border bg-card text-foreground shadow-paper rounded-md border p-3">
        <p className="tnum text-sm font-semibold">
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
      <h3 className="text-foreground/60 mb-4 text-center font-sans text-xs font-bold tracking-[0.12em] uppercase">
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
            formatter={(value: string) => <span className="text-foreground/70">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// "How much to buy" card: enter a cash budget and see the buy-only plan that
// moves the selected assets toward their declared targets. Pure client math
// (computeBuyPlan over the same slices the pies use) — nothing is persisted.
function BuyPlanCard({
  slices,
  displayCurrency,
  rates,
}: {
  slices: AllocationSlice[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
}) {
  // NaN while the field is empty (same convention as the target inputs).
  const [budget, setBudget] = useState<number | undefined>(undefined);
  // Currency the budget is entered in. Slices (and so the whole plan math) live
  // in `displayCurrency`, so we convert the budget into it before planning and
  // convert every money output back into `planCurrency` for display — the pies
  // and real % stay untouched in `displayCurrency`.
  const [planCurrency, setPlanCurrency] = useState<Currency>(displayCurrency);
  const budgetInDisplay = convertAmount(num(budget), planCurrency, displayCurrency, rates);
  const plan = computeBuyPlan(slices, budgetInDisplay);
  // Render a display-currency value in the chosen budget currency.
  const show = (value: number): string =>
    money(convertAmount(value, displayCurrency, planCurrency, rates), planCurrency);

  return (
    <div className="border-border bg-card rounded-md border p-6 lg:col-span-3">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-foreground/60 flex items-center gap-2 font-sans text-xs font-bold tracking-[0.12em] uppercase">
          <Wallet className="size-4" />
          Buy plan
        </h2>
        <label className="text-foreground/70 flex items-center gap-2 text-sm">
          Available to invest
          <input
            type="number"
            inputMode="decimal"
            aria-label="Available money to invest"
            value={budget === undefined || Number.isNaN(budget) ? "" : budget}
            onChange={(e) => {
              setBudget(e.target.valueAsNumber);
            }}
            min={0}
            step={100}
            placeholder="0"
            className="border-input bg-card text-foreground focus:border-primary tnum w-32 rounded-sm border px-3 py-2 text-right text-sm transition-colors focus:outline-none"
          />
          <select
            aria-label="Budget currency"
            value={planCurrency}
            onChange={(e) => {
              setPlanCurrency(e.target.value as Currency);
            }}
            className="border-input bg-card text-foreground focus:border-primary appearance-none rounded-sm border px-2 py-2 text-sm transition-colors focus:outline-none"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {plan === null ? (
        <p className="text-muted-foreground text-sm">
          Set a target percentage on at least one asset above to compute a buy plan.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-foreground/60 border-b text-left text-xs tracking-[0.12em] uppercase">
                  <th className="py-2 pr-4 font-bold">Asset</th>
                  <th className="py-2 pr-4 text-right font-bold">Current</th>
                  <th className="py-2 pr-4 text-right font-bold">Target</th>
                  <th className="py-2 pr-4 text-right font-bold">Buy</th>
                  <th className="py-2 text-right font-bold">After</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row, index) => (
                  <tr key={row.asset_id} className="border-border border-b">
                    <td className="text-foreground flex items-center gap-2 py-2 pr-4">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorFor(index) }} />
                      <span className="truncate">{row.name}</span>
                    </td>
                    <td className="text-foreground/70 tnum py-2 pr-4 text-right">{show(row.currentValue)}</td>
                    <td className="text-muted-foreground tnum py-2 pr-4 text-right">{row.targetPct.toFixed(1)}%</td>
                    <td
                      className={
                        row.buy > 0
                          ? "text-gain tnum py-2 pr-4 text-right font-medium"
                          : "text-muted-foreground tnum py-2 pr-4 text-right"
                      }
                    >
                      {row.buy > 0 ? `+${show(row.buy)}` : "—"}
                    </td>
                    <td className="text-foreground/70 tnum py-2 text-right">{row.finalPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-sm">
            <span className="text-foreground/70">
              Deployed <strong className="text-foreground tnum">{show(plan.deployed)}</strong>
            </span>
            {plan.leftover > 0.01 && (
              <span className="border-kraft bg-kraft/40 text-foreground/80 tnum rounded-sm border px-2 py-1">
                Leftover {show(plan.leftover)} — everything else is already at or above target
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// One portfolio card's full editor: select panel + both pies + buy plan, plus an
// inline-editable name and a delete control. State is seeded from `card.targets`
// and lives locally; the component is keyed by card id in the parent so a tab
// switch remounts it fresh (unsaved edits don't bleed across tabs). On save it
// lifts the persisted targets back up via `onSaved` so switching away and back
// reflects what's stored.
function PortfolioCard({
  card,
  assets,
  displayCurrency,
  rates,
  onRename,
  onDelete,
  onSaved,
}: {
  card: CardData;
  assets: BalancerAsset[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSaved: (id: string, targets: Record<string, number>) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(Object.keys(card.targets)));
  // A selected asset with no saved target has no key here, so the value is
  // genuinely `number | undefined` at runtime; num() coerces the gap to 0.
  const [targets, setTargets] = useState<Record<string, number | undefined>>(() => ({ ...card.targets }));
  // The asset currently chosen in the "add" dropdown, before the + button
  // commits it to the selected set. "" means nothing picked.
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Local mirror of the card name so the input is editable without a round-trip;
  // committed (PATCH via onRename) on blur / Enter.
  const [name, setName] = useState(card.name);

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

    const payloadTargets = assets
      .filter((a) => selected.has(a.asset_id))
      .map((a) => ({ asset_id: a.asset_id, target_pct: num(targets[a.asset_id]) }));

    try {
      const res = await fetch("/api/allocation-targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: card.id, targets: payloadTargets }),
      });
      const json = (await res.json()) as { error?: { message: string } };

      if (json.error) {
        setError(json.error.message);
        setPending(false);
        return;
      }

      // Lift the persisted set up so the parent's card state stays in sync (no
      // full-page reload needed — current values haven't changed).
      const savedMap: Record<string, number> = {};
      for (const t of payloadTargets) savedMap[t.asset_id] = t.target_pct;
      onSaved(card.id, savedMap);
      setPending(false);
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  // Commit a rename on blur / Enter; reset to the saved name if cleared/unchanged.
  function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === card.name) {
      setName(card.name);
      return;
    }
    onRename(card.id, trimmed);
  }

  return (
    <div className="space-y-6">
      {/* Card header: inline-editable name + delete. */}
      <div className="flex items-center justify-between gap-3">
        <input
          aria-label="Portfolio name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          maxLength={60}
          className="font-display text-foreground hover:border-border focus:border-primary min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2 py-1 text-lg font-bold transition-colors focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            onDelete(card.id);
          }}
          className="border-destructive text-destructive hover:bg-destructive hover:text-background flex shrink-0 items-center gap-1.5 rounded-sm border-[1.5px] px-3 py-1.5 text-sm transition-colors"
        >
          <Trash2 className="size-4" />
          Delete
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="border-border bg-card rounded-md border p-6 lg:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-foreground/60 font-sans text-xs font-bold tracking-[0.12em] uppercase">
              Select assets &amp; targets
            </h2>
            <span
              className={
                sumOffBy100 ? "text-destructive tnum text-xs font-medium" : "text-muted-foreground tnum text-xs"
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
                className="border-input bg-card text-foreground focus:border-primary w-full appearance-none rounded-sm border px-3 py-2 pr-8 text-sm transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex size-9 shrink-0 items-center justify-center rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-4" />
            </button>
          </div>

          {/* Configurable list: one row per selected asset with its target input
            and a "−" button to remove it from the set. */}
          {selectedAssets.length === 0 ? (
            <p className="text-muted-foreground mt-4 text-sm">
              No assets selected yet. Add one above to set its target.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {selectedAssets.map((asset) => {
                const target = targets[asset.asset_id];
                return (
                  <div
                    key={asset.asset_id}
                    className="border-border flex items-center gap-2 rounded-sm border px-3 py-2"
                  >
                    <span className="text-foreground flex-1 truncate text-sm">{asset.name}</span>
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
                      className="border-input bg-card text-foreground focus:border-primary tnum w-20 rounded-sm border px-2 py-1 text-right text-sm transition-colors focus:outline-none"
                    />
                    <span className="text-muted-foreground text-sm">%</span>
                    <button
                      type="button"
                      onClick={() => {
                        removeAsset(asset.asset_id);
                      }}
                      aria-label={`Remove ${asset.name}`}
                      className="border-input text-foreground/60 hover:border-destructive hover:text-destructive flex size-7 shrink-0 items-center justify-center rounded-sm border transition-colors"
                    >
                      <Minus className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {sumOffBy100 && (
            <p className="border-kraft bg-kraft/40 text-foreground/80 mt-3 rounded-sm border px-2 py-1 text-xs">
              Your targets don&apos;t add up to 100%. You can still save — the declared pie shows your raw percentages.
            </p>
          )}

          <ServerError message={error} />

          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 flex items-center gap-2 rounded-sm px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <>
                <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
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
        <div className="border-border bg-card rounded-md border p-6 lg:col-span-2">
          {hasSelection ? (
            <div className="grid gap-6 md:grid-cols-2">
              <AllocationPie title="Declared (target %)" slices={result.slices} mode="declared" />
              <AllocationPie title="Real (current value)" slices={result.slices} mode="real" />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center py-12 text-center">
              <p className="text-foreground/70 text-sm">
                Add one or more assets to compare your declared targets against their real current-value allocation.
              </p>
            </div>
          )}
        </div>

        {/* Full-width buy-plan card: deploy a cash budget toward the targets. */}
        {hasSelection && <BuyPlanCard slices={result.slices} displayCurrency={displayCurrency} rates={rates} />}
      </div>
    </div>
  );
}

// Tab manager: one tab per portfolio card plus an "add" affordance. Renders the
// active card's editor. Card metadata (name, membership) lives here so create /
// rename / delete update the tab bar immediately; each card's target editing is
// owned by the keyed PortfolioCard below.
export function BalancerView({ assets, cards: initialCards, displayCurrency, rates }: Props) {
  const [cards, setCards] = useState<CardData[]>(initialCards);
  const [activeId, setActiveId] = useState<string | null>(initialCards[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addCard() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/allocation-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Portfolio ${cards.length + 1}` }),
      });
      const json = (await res.json()) as {
        data?: { id: string; name: string; position: number };
        error?: { message: string };
      };
      if (json.error || !json.data) {
        setError(json.error?.message ?? "Failed to create portfolio.");
        setBusy(false);
        return;
      }
      const created: CardData = { ...json.data, targets: {} };
      setCards((prev) => [...prev, created]);
      setActiveId(created.id);
      setBusy(false);
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  // Optimistic rename — the PATCH is fire-and-forget; the tab updates instantly.
  function renameCard(id: string, name: string) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    void fetch(`/api/allocation-cards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  async function deleteCard(id: string) {
    if (!window.confirm("Delete this portfolio? Its targets will be removed.")) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/allocation-cards/${id}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: { message: string } };
      if (json.error) {
        setError(json.error.message);
        setBusy(false);
        return;
      }
      const remaining = cards.filter((c) => c.id !== id);
      setCards(remaining);
      if (activeId === id) setActiveId(remaining[0]?.id ?? null);
      setBusy(false);
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  function handleSaved(id: string, targets: Record<string, number>) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, targets } : c)));
  }

  if (assets.length === 0) {
    return (
      <div className="border-kraft rounded-md border-2 border-dashed p-8 text-center">
        <p className="text-foreground/70 text-sm">
          You have no assets yet. Add some assets first, then come back to set your target allocation.
        </p>
      </div>
    );
  }

  const activeCard = cards.find((c) => c.id === activeId) ?? null;

  return (
    <div className="space-y-6">
      {/* Tab bar: one tab per card + an "add portfolio" button. */}
      <div className="flex flex-wrap items-center gap-2">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setActiveId(c.id);
            }}
            className={
              c.id === activeId
                ? "bg-primary text-primary-foreground max-w-[12rem] truncate rounded-sm px-4 py-2 text-sm font-medium"
                : "border-border text-foreground/70 hover:border-primary hover:text-primary max-w-[12rem] truncate rounded-sm border px-4 py-2 text-sm transition-colors"
            }
          >
            {c.name}
          </button>
        ))}
        <button
          type="button"
          onClick={addCard}
          disabled={busy}
          className="border-kraft text-foreground/70 hover:border-primary hover:text-primary flex items-center gap-1.5 rounded-sm border border-dashed px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" />
          Add portfolio
        </button>
      </div>

      <ServerError message={error} />

      {activeCard ? (
        <PortfolioCard
          key={activeCard.id}
          card={activeCard}
          assets={assets}
          displayCurrency={displayCurrency}
          rates={rates}
          onRename={renameCard}
          onDelete={deleteCard}
          onSaved={handleSaved}
        />
      ) : (
        <div className="border-kraft rounded-md border-2 border-dashed p-8 text-center">
          <p className="text-foreground/70 mb-4 text-sm">
            No portfolios yet. Create one to set target allocations and compare them against your real split.
          </p>
          <button
            type="button"
            onClick={addCard}
            disabled={busy}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-sm px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="size-4" />
            Create your first portfolio
          </button>
        </div>
      )}
    </div>
  );
}
