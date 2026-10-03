// The one definition of a "priced holding": a crypto or precious-metal asset
// whose stored `amount` is derived as quantity × live price. The reprice path
// (src/lib/reprice.ts) and the staleness check (src/lib/stale-prices.ts) both
// read it, so they cannot disagree about which rows are priced. It has no
// imports on purpose: the dashboard island pulls it into the browser bundle.

export type PriceSource = "crypto" | "metal";

export interface PriceKey {
  source: PriceSource;
  symbol: string;
  quantity: number;
}

export interface PricedFields {
  quantity: number | null;
  crypto_symbol: string | null;
  metal_symbol: string | null;
}

export function priceKeyFor(asset: PricedFields): PriceKey | null {
  const quantity = asset.quantity;
  if (quantity === null || !(quantity > 0)) return null;
  const crypto = asset.crypto_symbol?.trim().toUpperCase();
  if (crypto) return { source: "crypto", symbol: crypto, quantity };
  const metal = asset.metal_symbol?.trim().toUpperCase();
  if (metal) return { source: "metal", symbol: metal, quantity };
  return null;
}
