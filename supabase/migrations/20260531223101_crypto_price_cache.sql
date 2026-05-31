-- crypto_price_cache: cache for live-fetched crypto prices (TTL: 3600s)
-- RLS: SELECT is public (read-only financial data), INSERT/UPDATE via SECURITY DEFINER

BEGIN;

CREATE TABLE crypto_price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coin_id TEXT NOT NULL UNIQUE,
  coin_symbol TEXT NOT NULL,
  price_usd NUMERIC(20, 8) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crypto_price_cache_symbol ON crypto_price_cache(coin_symbol);

ALTER TABLE crypto_price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read crypto prices" ON crypto_price_cache
  FOR SELECT USING (true);

-- SECURITY DEFINER: global data (same for all users), no per-user RLS needed
CREATE OR REPLACE FUNCTION upsert_crypto_price_cache(
  p_coin_id TEXT,
  p_coin_symbol TEXT,
  p_price_usd NUMERIC
)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO crypto_price_cache (coin_id, coin_symbol, price_usd, fetched_at)
  VALUES (p_coin_id, p_coin_symbol, p_price_usd, NOW())
  ON CONFLICT (coin_id) DO UPDATE SET
    coin_symbol = EXCLUDED.coin_symbol,
    price_usd = EXCLUDED.price_usd,
    fetched_at = EXCLUDED.fetched_at;
END;
$$;

-- assets: add quantity column (coin amount, separate from fiat total value)
ALTER TABLE assets ADD COLUMN quantity NUMERIC;

COMMIT;