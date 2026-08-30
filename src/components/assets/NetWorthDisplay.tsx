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
  const colorClass = isPositive ? "text-gain" : "text-loss";
  const sign = isPositive ? "+" : "−";
  const arrow = isPositive ? "▲" : "▼";
  return (
    <div>
      <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">{label}</p>
      <p className={`tnum mt-1 text-sm font-bold ${colorClass}`}>
        {arrow} {sign}
        {absValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({sign}
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
  const [stampDate, setStampDate] = useState<{ month: string; year: string } | null>(null);
  // Set when the server could not refresh one or more priced holdings; the
  // snapshot still saved (with stored values), so this is a notice, not an error.
  const [repriceWarning, setRepriceWarning] = useState<string | null>(null);
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
      const json = (await res.json()) as {
        error?: { message?: string };
        repricing?: { failed?: { symbol: string }[] };
      };
      if (!res.ok) {
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      const failedSymbols = [...new Set((json.repricing?.failed ?? []).map((f) => f.symbol))];
      const warning =
        failedSymbols.length > 0 ? `Price unavailable for ${failedSymbols.join(", ")} — stored values used.` : null;
      setRepriceWarning(warning);
      // The stamp landing: seal the month visibly, then refresh. The delay is
      // the animation's moment — long enough to read, short enough to not stall.
      // A reprice warning gets longer so it can actually be read before reload.
      const now = new Date();
      setStampDate({
        month: now.toLocaleDateString("en-US", { month: "short" }),
        year: String(now.getFullYear()),
      });
      closeDialog();
      setState("saved");
      setTimeout(
        () => {
          onSuccess();
          window.location.reload();
        },
        warning ? 4000 : 1200,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setState("error");
      onError(msg);
      setTimeout(() => {
        setState("idle");
      }, 3000);
    }
  }, [state, contribution, closeDialog, onSuccess, onError]);

  const triggerLabel = state === "error" ? "Retry snapshot" : "Save snapshot — stamp the month";
  const triggerClass =
    state === "error"
      ? "w-full rounded-sm border-[1.5px] border-destructive px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive hover:text-background"
      : "w-full rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90";

  return (
    <>
      {state === "saved" ? (
        <div className="flex items-center justify-center gap-3 py-1" role="status">
          <span
            className="stamp-land border-seal text-seal flex h-14 w-14 flex-none flex-col items-center justify-center rounded-full border-2 leading-none font-bold uppercase"
            aria-hidden="true"
          >
            <span className="text-xs tracking-widest">{stampDate?.month}</span>
            <span className="tnum mt-0.5 text-xs">{stampDate?.year}</span>
          </span>
          <span className="flex flex-col">
            <span className="text-gain text-sm font-bold">Month stamped — refreshing…</span>
            {repriceWarning && <span className="text-muted-foreground text-xs">{repriceWarning}</span>}
          </span>
        </div>
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
        className="bg-card text-card-foreground shadow-paper border-border w-[min(92vw,28rem)] rounded-md border p-0 backdrop:bg-[#3b2f2a]/50"
      >
        <div className="border-border flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-display text-base font-bold">Save snapshot</h2>
        </div>
        <div className="px-5 py-5">
          <ContributionField
            id="save-net-contribution"
            value={contribution}
            onChange={setContribution}
            currency={displayCurrency}
            disabled={state === "loading"}
          />
        </div>
        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={closeDialog}
            disabled={state === "loading"}
            className="border-primary text-primary hover:bg-primary/8 rounded-sm border-[1.5px] px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={state === "loading"}
            className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50 flex items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
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
    <div className="bg-card border-primary/60 rounded-md border-[1.5px] p-6">
      {/* The wrapper band: a kraft strap across the lid, bearing the seal. */}
      <div className="bg-kraft/50 border-border -mx-6 -mt-6 mb-4 flex items-center justify-between gap-3 rounded-t-[4px] border-b px-6 py-2.5">
        <h2 className="text-foreground/70 flex items-center gap-2 font-sans text-xs font-bold tracking-[0.12em] uppercase">
          <svg viewBox="0 0 48 48" className="text-seal h-4.5 w-4.5 flex-none" fill="none" aria-hidden="true">
            <circle cx="24" cy="24" r="21.5" stroke="currentColor" strokeWidth="3.5" />
            <path
              d="M9 32 L16 24 L21 28 L29 17 L33 21 L39 13"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Net worth
        </h2>
        <CurrencyBadge currency={displayCurrency} />
      </div>

      {ratesError && <p className="text-loss mb-2 text-xs font-medium">{ratesError}</p>}

      <p
        className={`font-display tnum mb-4 text-4xl font-extrabold sm:text-5xl ${
          currentNetWorth < 0 ? "text-loss" : "text-foreground"
        }`}
      >
        {currentNetWorth.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
        {displayCurrency}
      </p>

      <div className="border-border mb-4 grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
        <div>
          <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Assets</p>
          <p className="text-gain tnum mt-1 text-lg font-bold">
            +
            {assets
              .filter((a) => !a.category.is_liability)
              .reduce((sum, a) => sum + convertAmount(a.amount, a.currency as Currency, displayCurrency, rates), 0)
              .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </p>
        </div>
        <div>
          <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Liabilities</p>
          <p className="text-loss tnum mt-1 text-lg font-bold">
            −
            {assets
              .filter((a) => a.category.is_liability)
              .reduce((sum, a) => sum + convertAmount(a.amount, a.currency as Currency, displayCurrency, rates), 0)
              .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </p>
        </div>
      </div>

      {snapshots.length > 0 && (
        <div className="border-border mb-4 grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
          {deltaLastMonth ? (
            <DeltaIndicator label="vs Last Month" value={deltaLastMonth.value} percentage={deltaLastMonth.pct} />
          ) : (
            <div>
              <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">vs Last Month</p>
              <p className="text-muted-foreground mt-1 text-sm">No baseline yet</p>
            </div>
          )}
          {deltaJan ? (
            <DeltaIndicator label="vs Jan 1st" value={deltaJan.value} percentage={deltaJan.pct} />
          ) : (
            <div>
              <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">vs Jan 1st</p>
              <p className="text-muted-foreground mt-1 text-sm">No baseline yet</p>
            </div>
          )}
        </div>
      )}

      {snapshotError && <p className="text-loss mb-2 text-xs font-medium">{snapshotError}</p>}

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
