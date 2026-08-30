import type { SupabaseClient } from "@supabase/supabase-js";
import { getPrice as getCryptoPrice } from "./crypto-prices";
import { getPrice as getMetalPrice } from "./metal-prices";

// A priced holding (crypto / precious metal) stores `amount = quantity × price`
// as a fiat USD total, computed once in the browser at entry/edit time and never
// refreshed. Anything that *records* that amount (a snapshot) must refresh it
// first, or the recorded series tracks FX drift but not the asset itself.
// See context/foundation/lessons.md "Derived amounts stored on a row go stale".

export interface RepriceableAsset {
  id: string;
  name: string;
  amount: number;
  currency: string;
  quantity: number | null;
  crypto_symbol: string | null;
  metal_symbol: string | null;
}

export interface RepricedEntry {
  id: string;
  name: string;
  symbol: string;
  oldAmount: number;
  newAmount: number;
  priceUsd: number;
}

export interface RepriceFailure {
  id: string;
  name: string;
  symbol: string;
  code: string;
}

export interface RepriceResult<T> {
  /** Same rows, `amount` (and `currency`) refreshed where a live price was available. */
  assets: T[];
  repriced: RepricedEntry[];
  /** Stored amount kept for these — price unavailable or the write failed. */
  failed: RepriceFailure[];
}

type PriceSource = "crypto" | "metal";

interface PriceKey {
  source: PriceSource;
  symbol: string;
  quantity: number;
}

function priceKeyFor(asset: RepriceableAsset): PriceKey | null {
  const quantity = asset.quantity;
  if (quantity === null || !(quantity > 0)) return null;
  const crypto = asset.crypto_symbol?.trim().toUpperCase();
  if (crypto) return { source: "crypto", symbol: crypto, quantity };
  const metal = asset.metal_symbol?.trim().toUpperCase();
  if (metal) return { source: "metal", symbol: metal, quantity };
  return null;
}

type PriceOutcome = { price: number } | { code: string };

async function fetchPrice(supabase: SupabaseClient, source: PriceSource, symbol: string): Promise<PriceOutcome> {
  try {
    const result = source === "crypto" ? await getCryptoPrice(supabase, symbol) : await getMetalPrice(supabase, symbol);
    if ("error" in result) return { code: result.error.code };
    return { price: result.price };
  } catch {
    return { code: "PRICE_UNAVAILABLE" };
  }
}

/**
 * Refreshes `amount` for every priced holding from live (or ≤1h-cached) prices
 * and persists the new value to `assets`. Never throws: a holding whose price
 * cannot be fetched (or whose write fails) keeps its stored amount and is
 * reported in `failed`. Unpriced rows pass through untouched.
 */
export async function repriceAssets<T extends RepriceableAsset>(
  supabase: SupabaseClient,
  assets: T[],
): Promise<RepriceResult<T>> {
  // One fetch per distinct (source, symbol) — both price helpers cache 1h.
  const keys = new Map<string, PriceKey>();
  for (const asset of assets) {
    const key = priceKeyFor(asset);
    if (key) keys.set(`${key.source}:${key.symbol}`, key);
  }

  const prices = new Map<string, PriceOutcome>();
  await Promise.all(
    [...keys.entries()].map(async ([id, { source, symbol }]) => {
      prices.set(id, await fetchPrice(supabase, source, symbol));
    }),
  );

  const repriced: RepricedEntry[] = [];
  const failed: RepriceFailure[] = [];
  const out: T[] = [];

  for (const asset of assets) {
    const key = priceKeyFor(asset);
    if (!key) {
      out.push(asset);
      continue;
    }
    const outcome = prices.get(`${key.source}:${key.symbol}`);
    if (!outcome || "code" in outcome) {
      failed.push({ id: asset.id, name: asset.name, symbol: key.symbol, code: outcome?.code ?? "PRICE_UNAVAILABLE" });
      out.push(asset);
      continue;
    }

    // Same cents rounding as PricedQuantityFields so a snapshot-time reprice
    // and a form-time reprice of the same quantity agree to the cent.
    const newAmount = Math.round(key.quantity * outcome.price * 100) / 100;
    if (newAmount === asset.amount && asset.currency === "USD") {
      out.push(asset);
      continue;
    }

    const { error } = await supabase.from("assets").update({ amount: newAmount, currency: "USD" }).eq("id", asset.id);
    if (error) {
      failed.push({ id: asset.id, name: asset.name, symbol: key.symbol, code: error.code || "UPDATE_FAILED" });
      out.push(asset);
      continue;
    }

    repriced.push({
      id: asset.id,
      name: asset.name,
      symbol: key.symbol,
      oldAmount: asset.amount,
      newAmount,
      priceUsd: outcome.price,
    });
    out.push({ ...asset, amount: newAmount, currency: "USD" });
  }

  return { assets: out, repriced, failed };
}
