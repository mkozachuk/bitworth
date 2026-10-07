import { useState, useEffect, useCallback, useRef } from "react";
import { CurrencyBadge } from "./CurrencyBadge";
import { ContributionField } from "./ContributionField";
import type { Tables } from "@/lib/database.types";
import { computeNetWorth, type Currency } from "@/lib/net-worth";
import { computeNetWorthDeltas, type SnapshotDelta } from "@/lib/net-worth-deltas";

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

function DeltaIndicator({ label, delta }: { label: string; delta: SnapshotDelta | null }) {
  const heading = <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">{label}</p>;
  if (!delta) {
    return (
      <div>
        {heading}
        <p className="text-muted-foreground mt-1 text-sm">No baseline yet</p>
      </div>
    );
  }
  if (delta.kind === "currency-changed") {
    // Snapshot totals carry no save-time FX rate, so a baseline stored in another
    // currency cannot be compared honestly: say so instead of showing a number.
    return (
      <div>
        {heading}
        <p className="text-muted-foreground mt-1 text-sm">Currency changed</p>
      </div>
    );
  }
  const { value, pct, baselineLabel } = delta;
  const isPositive = value >= 0;
  const absValue = Math.abs(value);
  const colorClass = isPositive ? "text-gain" : "text-loss";
  const sign = isPositive ? "+" : "−";
  const arrow = isPositive ? "▲" : "▼";
  return (
    <div>
      {heading}
      <p className={`tnum mt-1 text-sm font-bold ${colorClass}`}>
        {arrow} {sign}
        {absValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        {pct !== null && (
          <>
            {" "}
            ({sign}
            {Math.abs(pct).toFixed(1)}%)
          </>
        )}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">since {baselineLabel}</p>
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
  const [income, setIncome] = useState("");
  const [stampDate, setStampDate] = useState<{ month: string; year: string } | null>(null);
  // Set when the server could not refresh one or more priced holdings; the
  // snapshot still saved (with stored values), so this is a notice, not an error.
  const [repriceWarning, setRepriceWarning] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const openDialog = useCallback(() => {
    if (state === "loading") return;
    setContribution("");
    setIncome("");
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

    // Build the request body: a blank field records an unknown value (key left
    // out; no body at all when both are blank), a filled field sends a parsed
    // number: signed for the contribution, >= 0 for income. Guard NaN client-side.
    const trimmed = contribution.trim();
    const trimmedIncome = income.trim();
    let init: RequestInit = {
      method: "POST",
      credentials: "include",
    };
    const payload: { net_contribution?: number; income?: number } = {};
    if (trimmed !== "") {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        onError("Net contribution must be a number");
        return;
      }
      payload.net_contribution = parsed;
    }
    if (trimmedIncome !== "") {
      const parsed = Number(trimmedIncome);
      if (!Number.isFinite(parsed) || parsed < 0) {
        onError("Income must be a number of 0 or more");
        return;
      }
      payload.income = parsed;
    }
    if (Object.keys(payload).length > 0) {
      init = {
        ...init,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
  }, [state, contribution, income, closeDialog, onSuccess, onError]);

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
        <div className="flex flex-col gap-4 px-5 py-5">
          <ContributionField
            id="save-net-contribution"
            value={contribution}
            onChange={setContribution}
            currency={displayCurrency}
            disabled={state === "loading"}
          />
          {/* Inline rather than <IncomeField>: this slice keeps the file's diff
              inside SaveButton, imports included. Same markup and wording. */}
          <div className="flex flex-col gap-1">
            <label htmlFor="save-income" className="text-foreground/70 text-sm font-medium">
              Income (after tax)
            </label>
            <input
              id="save-income"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              value={income}
              disabled={state === "loading"}
              onChange={(e) => {
                setIncome(e.target.value);
              }}
              placeholder="e.g. 4000"
              className="border-input bg-card text-foreground focus:border-primary tnum w-full rounded-sm border px-3 py-2 text-sm transition-colors focus:outline-none disabled:opacity-50"
            />
            <p className="text-muted-foreground text-xs">
              Amount in {displayCurrency} earned since your previous snapshot. Used for your savings rate. Leave blank
              if unknown.
            </p>
          </div>
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

  // One calculation feeds the headline, Assets and Liabilities. The DB
  // `currency` string is cast to Currency at the boundary (Currency cast lesson).
  const {
    totalAssets,
    totalLiabilities,
    netWorth: currentNetWorth,
  } = computeNetWorth(
    assets.map((a) => ({ ...a, currency: a.currency as Currency })),
    displayCurrency,
    rates,
  );

  // Baselines are anchored on the newest snapshot, never on the wall clock.
  const { lastMonth, jan } = computeNetWorthDeltas(snapshots);

  return (
    <div id="snapshot-save" className="bg-card border-primary/60 rounded-md border-[1.5px] p-6">
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
            +{totalAssets.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </p>
        </div>
        <div>
          <p className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">Liabilities</p>
          <p className="text-loss tnum mt-1 text-lg font-bold">
            −{totalLiabilities.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {displayCurrency}
          </p>
        </div>
      </div>

      {snapshots.length > 0 && (
        <div className="border-border mb-4 grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
          <DeltaIndicator label="vs Last Month" delta={lastMonth} />
          <DeltaIndicator label="vs Jan 1st" delta={jan} />
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
