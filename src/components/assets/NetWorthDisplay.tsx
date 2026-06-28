import { useState, useEffect, useCallback, useRef } from "react";
import { CurrencyBadge } from "./CurrencyBadge";
import { ContributionField } from "./ContributionField";
import type { Tables } from "@/lib/database.types";
import { convertAmount, type Currency } from "@/lib/net-worth";

type AssetWithCategory = Tables<"assets"> & { category: Tables<"asset_categories"> };
type SnapshotRow = Tables<"snapshots">;

interface Props {
  assets: AssetWithCategory[];
  displayCurrency: Currency;
  rates: Record<Currency, number>;
  snapshots?: SnapshotRow[];
  onSnapshotSaved?: () => void;
}

type ButtonState = "idle" | "loading" | "saved" | "error";

function DeltaIndicator({ label, value, percentage }: { label: string; value: number; percentage: number }) {
  const isPositive = value >= 0;
  const absValue = Math.abs(value);
  const absPct = Math.abs(percentage);
  const colorClass = isPositive ? "text-green-600 dark:text-green-300" : "text-red-600 dark:text-red-300";
  const sign = isPositive ? "+" : "-";
  return (
    <div>
      <p className="text-xs tracking-wider text-zinc-500 uppercase dark:text-white/50">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${colorClass}`}>
        {sign}${absValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({sign}
        {absPct.toFixed(1)}%)
      </p>
    </div>
  );
}

function SaveButton({
  displayCurrency,
  onSuccess,
  onError,
}: {
  displayCurrency: Currency;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [state, setState] = useState<ButtonState>("idle");
  const [contribution, setContribution] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  const openDialog = useCallback(() => {
    if (state === "loading") return;
    setContribution("");
    setState("idle");
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [state]);

  const closeDialog = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
  }, []);

  const handleConfirm = useCallback(async () => {
    if (state === "loading") return;

    // Build the request body: a blank field records an unknown split (no body),
    // a filled field sends a parsed signed number. Guard NaN client-side.
    const trimmed = contribution.trim();
    let init: RequestInit = {
      method: "POST",
      credentials: "include",
    };
    if (trimmed !== "") {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        onError("Net contribution must be a number");
        return;
      }
      init = {
        ...init,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ net_contribution: parsed }),
      };
    }

    setState("loading");
    try {
      const res = await fetch("/api/snapshots", init);
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
  }, [state, contribution, onSuccess, onError]);

  const triggerLabel = state === "error" ? "Retry" : "Save Snapshot";
  const triggerClass =
    state === "error"
      ? "w-full rounded-lg border border-red-500/50 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:bg-red-500/20 dark:text-red-300 dark:hover:bg-red-500/30"
      : "w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500";

  return (
    <>
      {state === "saved" ? (
        <button
          disabled
          className="w-full rounded-lg border border-green-500/50 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 transition-colors dark:bg-green-500/20 dark:text-green-300"
        >
          Saved!
        </button>
      ) : (
        <button onClick={openDialog} className={triggerClass}>
          {triggerLabel}
        </button>
      )}

      <dialog
        ref={dialogRef}
        onClose={closeDialog}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeDialog();
        }}
        className="w-[min(92vw,28rem)] rounded-2xl border border-zinc-200 bg-white/95 p-0 text-zinc-800 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm dark:border-white/10 dark:bg-zinc-900/95 dark:text-zinc-100"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-white/10">
          <h2 className="text-base font-semibold">Save Snapshot</h2>
        </div>
        <div className="px-5 py-5">
          <ContributionField
            value={contribution}
            onChange={setContribution}
            currency={displayCurrency}
            disabled={state === "loading"}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={closeDialog}
            disabled={state === "loading"}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-white/15 dark:text-white/80 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={state === "loading"}
            className="flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/50"
          >
            {state === "loading" ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </>
            ) : (
              "Confirm"
            )}
          </button>
        </div>
      </dialog>
    </>
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
      const converted = convertAmount(asset.amount, asset.currency as Currency, displayCurrency, rates);
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
      lastMonthSnap && lastMonthSnap.total_net_worth !== 0 && deltaLM !== null
        ? (deltaLM / Math.abs(lastMonthSnap.total_net_worth)) * 100
        : null;
    const pctJ =
      janSnap && janSnap.total_net_worth !== 0 && deltaJ !== null
        ? (deltaJ / Math.abs(janSnap.total_net_worth)) * 100
        : null;

    return {
      deltaLastMonth: deltaLM !== null && pctLM !== null ? { value: deltaLM, pct: pctLM } : null,
      deltaJan: deltaJ !== null && pctJ !== null ? { value: deltaJ, pct: pctJ } : null,
    };
  })();

  return (
    <div className="rounded-xl border border-zinc-200 bg-white/80 p-6 dark:border-white/10 dark:bg-white/5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-wider text-zinc-600 uppercase dark:text-white/60">Net Worth</h2>
        <CurrencyBadge currency={displayCurrency} />
      </div>

      {ratesError && <p className="mb-2 text-xs text-yellow-600 dark:text-yellow-300/80">{ratesError}</p>}

      <p
        className={`mb-4 text-4xl font-bold ${
          currentNetWorth < 0 ? "text-red-600 dark:text-red-300" : "text-zinc-900 dark:text-white"
        }`}
      >
        {currentNetWorth.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
        {displayCurrency}
      </p>

      <div className="mb-4 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-white/10">
        <div>
          <p className="text-xs tracking-wider text-zinc-500 uppercase dark:text-white/50">Assets</p>
          <p className="mt-1 text-lg font-semibold text-green-600 dark:text-green-300">
            +
            {assets
              .filter((a) => !a.category.is_liability)
              .reduce((sum, a) => sum + convertAmount(a.amount, a.currency as Currency, displayCurrency, rates), 0)
              .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </p>
        </div>
        <div>
          <p className="text-xs tracking-wider text-zinc-500 uppercase dark:text-white/50">Liabilities</p>
          <p className="mt-1 text-lg font-semibold text-red-600 dark:text-red-300">
            -
            {assets
              .filter((a) => a.category.is_liability)
              .reduce((sum, a) => sum + convertAmount(a.amount, a.currency as Currency, displayCurrency, rates), 0)
              .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </p>
        </div>
      </div>

      {snapshots.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-white/10">
          {deltaLastMonth ? (
            <DeltaIndicator label="vs Last Month" value={deltaLastMonth.value} percentage={deltaLastMonth.pct} />
          ) : (
            <div>
              <p className="text-xs tracking-wider text-zinc-500 uppercase dark:text-white/50">vs Last Month</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-white/40">No baseline</p>
            </div>
          )}
          {deltaJan ? (
            <DeltaIndicator label="vs Jan 1st" value={deltaJan.value} percentage={deltaJan.pct} />
          ) : (
            <div>
              <p className="text-xs tracking-wider text-zinc-500 uppercase dark:text-white/50">vs Jan 1st</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-white/40">No baseline</p>
            </div>
          )}
        </div>
      )}

      {snapshotError && <p className="mb-2 text-xs text-red-600 dark:text-red-300">{snapshotError}</p>}

      <SaveButton
        displayCurrency={displayCurrency}
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
