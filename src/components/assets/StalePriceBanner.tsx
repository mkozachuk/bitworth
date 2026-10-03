import { useState } from "react";
import { ageInDays, stalePricedAssets, type StaleCandidate } from "@/lib/stale-prices";

interface Props {
  assets: StaleCandidate[];
  /** The server's clock at render time, so the server and client agree on the age. */
  nowMs: number;
  /** Called once amounts were refreshed; defaults to reloading the page. */
  onRepriced?: () => void;
}

interface RepriceResponse {
  data?: {
    repriced?: unknown[];
    unchanged?: unknown[];
    failed?: { symbol: string }[];
  };
  error?: { message?: string };
}

type State = "idle" | "loading" | "refreshing";

export function staleBannerText(count: number, oldestDays: number): string {
  const days = `${oldestDays} ${oldestDays === 1 ? "day" : "days"} old`;
  return count === 1 ? `Price for 1 holding is ${days}` : `Prices for ${count} holdings are ${days}`;
}

/**
 * Dashboard notice for priced holdings (crypto / metals) whose stored amount
 * has not been refreshed for more than 7 days. Renders nothing when none are.
 * "Reprice now" refreshes them in place, without saving a snapshot.
 */
export function StalePriceBanner({ assets, nowMs, onRepriced }: Props) {
  const [state, setState] = useState<State>("idle");
  // Same notice as the snapshot save's reprice warning: the stored values are
  // kept for these, so it is information, not an error.
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stale = stalePricedAssets(assets, nowMs);
  if (stale.length === 0) return null;
  const oldestDays = ageInDays(stale[0].updated_at, nowMs);

  async function reprice() {
    if (state !== "idle") return;
    setState("loading");
    setError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/assets/reprice", { method: "POST", credentials: "include" });
      const json = (await res.json()) as RepriceResponse;
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      const failedSymbols = [...new Set((json.data?.failed ?? []).map((f) => f.symbol))];
      const notice =
        failedSymbols.length > 0 ? `Price unavailable for ${failedSymbols.join(", ")} — stored values kept.` : null;
      setWarning(notice);
      const refreshed = (json.data?.repriced?.length ?? 0) + (json.data?.unchanged?.length ?? 0);
      if (refreshed === 0) {
        // Nothing changed on the server, so a reload would show the same page.
        setState("idle");
        return;
      }
      setState("refreshing");
      // A warning gets time to be read before the reload, as on snapshot save.
      setTimeout(
        () => {
          if (onRepriced) onRepriced();
          else window.location.reload();
        },
        notice ? 4000 : 0,
      );
    } catch (err) {
      setError(`Reprice failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      setState("idle");
    }
  }

  return (
    <div
      role="status"
      className="bg-secondary border-primary/60 mb-6 flex flex-col gap-3 rounded-md border-[1.5px] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-foreground text-sm font-bold">{staleBannerText(stale.length, oldestDays)}</p>
        <p className="text-muted-foreground text-xs">
          {state === "refreshing" ? "Prices refreshed — refreshing…" : "Their amounts may not match today's prices."}
        </p>
        {warning && <p className="text-muted-foreground text-xs">{warning}</p>}
        {error && <p className="text-loss text-xs font-medium">{error}</p>}
      </div>
      <button
        type="button"
        onClick={() => void reprice()}
        disabled={state !== "idle"}
        className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50 rounded-sm px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed"
      >
        {state === "loading" ? "Repricing..." : "Reprice now"}
      </button>
    </div>
  );
}
