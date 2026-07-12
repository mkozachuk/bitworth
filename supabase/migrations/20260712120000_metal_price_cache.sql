-- metal_price_cache: cache for live-fetched precious-metals spot prices (TTL: 3600s)
-- RLS: SELECT is public (read-only financial data), INSERT/UPDATE via SECURITY DEFINER

BEGIN;

CREATE TABLE metal_price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metal_id TEXT NOT NULL UNIQUE,
  metal_symbol TEXT NOT NULL,
  price_usd NUMERIC(20, 8) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_metal_price_cache_symbol ON metal_price_cache(metal_symbol);

ALTER TABLE metal_price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read metal prices" ON metal_price_cache
  FOR SELECT USING (true);

-- SECURITY DEFINER: global data (same for all users), no per-user RLS needed
CREATE OR REPLACE FUNCTION upsert_metal_price_cache(
  p_metal_id TEXT,
  p_metal_symbol TEXT,
  p_price_usd NUMERIC
)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO metal_price_cache (metal_id, metal_symbol, price_usd, fetched_at)
  VALUES (p_metal_id, p_metal_symbol, p_price_usd, NOW())
  ON CONFLICT (metal_id) DO UPDATE SET
    metal_symbol = EXCLUDED.metal_symbol,
    price_usd = EXCLUDED.price_usd,
    fetched_at = EXCLUDED.fetched_at;
END;
$$;

-- assets: add metal_symbol column (XAU/XAG, separate from crypto_symbol)
ALTER TABLE assets ADD COLUMN metal_symbol TEXT;

COMMIT;
