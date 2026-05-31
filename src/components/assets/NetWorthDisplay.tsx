import { useState, useEffect, useCallback } from "react";
import { CurrencyBadge } from "./CurrencyBadge";
import type { Tables } from "@/lib/database.types";

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };
type SnapshotRow = Tables<"snapshots">;
type Currency = "USD" | "EUR" | "PLN";

interface Props {
  assets: AssetWithCategory[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
  snapshots?: SnapshotRow[];
  onSnapshotSaved?: () => void;
}

function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: Currency,
  rates: Record<Currency, number>,
): number {
  if (fromCurrency === toCurrency) return amount;
  const inUSD = amount / rates[fromCurrency as Currency];
  return inUSD * rates[toCurrency];
}

type ButtonState = "idle" | "loading" | "saved" | "error";

function DeltaIndicator({ label, value, percentage }: { label: string; value: number; percentage: number }) {
  const isPositive = value >= 0;
  const absValue = Math.abs(value);
  const absPct = Math.abs(percentage);
  const colorClass = isPositive ? "text-green-300" : "text-red-300";
  const sign = isPositive ? "+" : "-";
  return (
    <div>
      <p className="text-xs tracking-wider text-white/50 uppercase">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${colorClass}`}>
        {sign}${absValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({sign}
        {absPct.toFixed(1)}%)
      </p>
    </div>
  );
}

function SaveButton({ onSuccess, onError }: { onSuccess: () => void; onError: (msg: string) => void }) {
  const [state, setState] = useState<ButtonState>("idle");

  const handleClick = useCallback(async () => {
    if (state !== "idle") return;
    setState("loading");
    try {
      const res = await fetch("/api/snapshots", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      onSuccess();
      window.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setState("error");
      onError(msg);
      setTimeout(() => {
        setState("idle");
      }, 3000);
    }
  }, [state, onSuccess, onError]);

  if (state === "saved") {
    return (
      <button
        disabled
        className="w-full rounded-lg border border-green-500/50 bg-green-500/20 px-4 py-2 text-sm font-medium text-green-300 transition-colors"
      >
        Saved!
      </button>
    );
  }

  if (state === "error") {
    return (
      <button
        onClick={handleClick}
        className="w-full rounded-lg border border-red-500/50 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/30"
      >
        Retry
      </button>
    );
  }

  if (state === "loading") {
    return (
      <button
        disabled
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600/50 px-4 py-2 text-sm font-medium text-white/70"
      >
        <svg
          className="h-4 w-4 animate-spin text-white/70"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Saving...
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
    >
      Save Snapshot
    </button>
  );
}

export function NetWorthDisplay({ assets, displayCurrency, rates, snapshots = [], onSnapshotSaved }: Props) {
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  // Client-side rates fetch — ensures deltas are computed with current rates
  useEffect(() => {
    const cached = sessionStorage.getItem("bw_rates");
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Record<Currency, number>;
        if (parsed.USD && parsed.EUR && parsed.PLN) return;
      } catch {
        sessionStorage.removeItem("bw_rates");
      }
    }
    fetch("/api/rates")
      .then((r) => r.json() as Promise<{ rates: Record<Currency, number> }>)
      .then(({ rates: r }) => {
        sessionStorage.setItem("bw_rates", JSON.stringify(r));
      })
      .catch(() => {
        setRatesError("Failed to fetch exchange rates — deltas may be outdated");
      });
  }, []);

  const currentNetWorth = (() => {
    let totalAssets = 0;
    let totalLiabilities = 0;
    for (const asset of assets) {
      const converted = convertAmount(asset.amount, asset.currency, displayCurrency, rates);
      if (asset.category.is_liability) {
        totalLiabilities += converted;
      } else {
        totalAssets += converted;
      }
    }
    return totalAssets - totalLiabilities;
  })();

  // Delta computation from snapshots
  const { deltaLastMonth, deltaJan } = (() => {
    if (snapshots.length === 0) return { deltaLastMonth: null, deltaJan: null };

    const sorted = [...snapshots].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const current = sorted[sorted.length - 1]; // newest
    // eslint-disable-next-line react-hooks/purity -- Date.now() is intentionally called at render time to determine the current date boundary
    const now = Date.now();
    const MS_25_DAYS = 25 * 24 * 60 * 60 * 1000;

    const lastMonthSnap = sorted.find((s) => now - new Date(s.created_at).getTime() >= MS_25_DAYS);
    const yearStart = new Date(`${new Date().getFullYear()}-01-01T00:00:00Z`);
    const janSnap = sorted.find((s) => new Date(s.created_at) <= yearStart);

    const deltaLM = lastMonthSnap ? current.total_net_worth - lastMonthSnap.total_net_worth : null;
    const deltaJ = janSnap ? current.total_net_worth - janSnap.total_net_worth : null;

    const pctLM =
      lastMonthSnap && lastMonthSnap.total_net_worth !== 0
        ? (deltaLM / Math.abs(lastMonthSnap.total_net_worth)) * 100
        : null;
    const pctJ = janSnap && janSnap.total_net_worth !== 0 ? (deltaJ / Math.abs(janSnap.total_net_worth)) * 100 : null;

    return {
      deltaLastMonth: deltaLM !== null && pctLM !== null ? { value: deltaLM, pct: pctLM } : null,
      deltaJan: deltaJ !== null && pctJ !== null ? { value: deltaJ, pct: pctJ } : null,
    };
  })();

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-wider text-white/60 uppercase">Net Worth</h2>
        <CurrencyBadge currency={displayCurrency} />
      </div>

      {ratesError && <p className="mb-2 text-xs text-yellow-300/80">{ratesError}</p>}

      <p className={`mb-4 text-4xl font-bold ${currentNetWorth < 0 ? "text-red-300" : "text-white"}`}>
        {currentNetWorth.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
        {displayCurrency}
      </p>

      <div className="mb-4 grid grid-cols-2 gap-4 border-t border-white/10 pt-4">
        <div>
          <p className="text-xs tracking-wider text-white/50 uppercase">Assets</p>
          <p className="mt-1 text-lg font-semibold text-green-300">
            +
            {assets
              .filter((a) => !a.category.is_liability)
              .reduce((sum, a) => sum + convertAmount(a.amount, a.currency, displayCurrency, rates), 0)
              .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </p>
        </div>
        <div>
          <p className="text-xs tracking-wider text-white/50 uppercase">Liabilities</p>
          <p className="mt-1 text-lg font-semibold text-red-300">
            -
            {assets
              .filter((a) => a.category.is_liability)
              .reduce((sum, a) => sum + convertAmount(a.amount, a.currency, displayCurrency, rates), 0)
              .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </p>
        </div>
      </div>

      {snapshots.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-4 border-t border-white/10 pt-4">
          {deltaLastMonth ? (
            <DeltaIndicator label="vs Last Month" value={deltaLastMonth.value} percentage={deltaLastMonth.pct} />
          ) : (
            <div>
              <p className="text-xs tracking-wider text-white/50 uppercase">vs Last Month</p>
              <p className="mt-1 text-sm text-white/40">No baseline</p>
            </div>
          )}
          {deltaJan ? (
            <DeltaIndicator label="vs Jan 1st" value={deltaJan.value} percentage={deltaJan.pct} />
          ) : (
            <div>
              <p className="text-xs tracking-wider text-white/50 uppercase">vs Jan 1st</p>
              <p className="mt-1 text-sm text-white/40">No baseline</p>
            </div>
          )}
        </div>
      )}

      {snapshotError && <p className="mb-2 text-xs text-red-300">{snapshotError}</p>}

      <SaveButton
        onSuccess={() => {
          setSnapshotError(null);
          onSnapshotSaved?.();
        }}
        onError={(msg) => {
          setSnapshotError(`Snapshot failed: ${msg}`);
        }}
      />
    </div>
  );
}
