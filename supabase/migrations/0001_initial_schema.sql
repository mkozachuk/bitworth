-- ============================================================
-- BitWorth MVP: Initial Schema
-- ============================================================
-- Profiles (extends auth.users), Assets, Snapshots,
-- Exchange Rates cache, Crypto Prices cache
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Profiles table (extends auth.users)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_currency TEXT NOT NULL DEFAULT 'PLN' CHECK (display_currency IN ('PLN', 'USD', 'EUR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can only see and manage their own profile
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_currency)
  VALUES (NEW.id, 'PLN');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Assets table
-- ============================================================
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('PLN', 'USD', 'EUR')),
  category TEXT NOT NULL CHECK (category IN (
    'Checking Account', 'Savings Account', 'Business/FOP Account',
    'Cash on Hand', 'Stocks', 'Investment Funds', 'Bonds',
    'Crypto', 'Precious Metals', 'Real Estate',
    'Vehicles & Valuables', 'Loans & Credit', 'P2P/Loans Given'
  )),
  is_liability BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own assets"
  ON assets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own assets"
  ON assets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own assets"
  ON assets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own assets"
  ON assets FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_assets_user_id ON assets(user_id);

-- Update trigger
CREATE OR REPLACE FUNCTION public.handle_asset_updated()
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_asset_updated
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION public.handle_asset_updated();

-- ============================================================
-- Snapshots table
-- ============================================================
CREATE TABLE snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_net_worth NUMERIC NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('PLN', 'USD', 'EUR')),
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snapshots"
  ON snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own snapshots"
  ON snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own snapshots"
  ON snapshots FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_snapshots_user_id ON snapshots(user_id);
CREATE INDEX idx_snapshots_snapshot_date ON snapshots(snapshot_date);
CREATE UNIQUE INDEX idx_snapshots_user_date ON snapshots(user_id, snapshot_date);

-- ============================================================
-- Exchange rates cache table
-- ============================================================
CREATE TABLE exchange_rates (
  currency_pair TEXT PRIMARY KEY,
  rate NUMERIC NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

-- Exchange rates are readable by all authenticated users
-- (rates are public data; writes handled by service role)
CREATE POLICY "Authenticated users can read exchange rates"
  ON exchange_rates FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- Crypto prices cache table
-- ============================================================
CREATE TABLE crypto_prices (
  symbol TEXT PRIMARY KEY,
  price_usd NUMERIC NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE crypto_prices ENABLE ROW LEVEL SECURITY;

-- Crypto prices are readable by all authenticated users
CREATE POLICY "Authenticated users can read crypto prices"
  ON crypto_prices FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- Auto-snapshot: fires on first login each calendar month
-- Tracking table + trigger function
-- ============================================================
CREATE TABLE IF NOT EXISTS auto_snapshot_log (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_snapshot_month DATE NOT NULL
);

ALTER TABLE auto_snapshot_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snapshot log"
  ON auto_snapshot_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own snapshot log"
  ON auto_snapshot_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own snapshot log"
  ON auto_snapshot_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Auto-snapshot: insert or update log, then create snapshot if needed
CREATE OR REPLACE FUNCTION public.handle_monthly_auto_snapshot(p_user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current_month DATE := DATE_TRUNC('month', CURRENT_DATE);
  v_display_currency TEXT;
  v_total_net_worth NUMERIC;
  v_snapshot_id UUID;
BEGIN
  -- Get user's display currency
  SELECT display_currency INTO v_display_currency
  FROM profiles WHERE id = p_user_id;

  -- Compute net worth: sum of assets converted to display currency
  -- For MVP, we use a simplified approach: sum of assets as-is (no currency conversion in trigger)
  -- Currency conversion is handled in the app layer
  SELECT COALESCE(SUM(CASE WHEN is_liability THEN -amount ELSE amount END), 0)
  INTO v_total_net_worth
  FROM assets
  WHERE user_id = p_user_id;

  -- Insert or update the log
  INSERT INTO auto_snapshot_log (user_id, last_snapshot_month)
  VALUES (p_user_id, v_current_month)
  ON CONFLICT (user_id) DO UPDATE
    SET last_snapshot_month = EXCLUDED.last_snapshot_month
  WHERE auto_snapshot_log.last_snapshot_month < v_current_month;

  -- Check if we actually created a new entry (new month)
  SELECT id INTO v_snapshot_id
  FROM snapshots
  WHERE user_id = p_user_id
    AND snapshot_date >= v_current_month
    AND snapshot_date < v_current_month + INTERVAL '1 month'
  LIMIT 1;

  -- Only create snapshot if none exists for this month
  IF v_snapshot_id IS NULL THEN
    INSERT INTO snapshots (user_id, total_net_worth, currency, snapshot_date)
    VALUES (p_user_id, v_total_net_worth, COALESCE(v_display_currency, 'PLN'), v_current_month)
    RETURNING id INTO v_snapshot_id;
  END IF;

  RETURN v_snapshot_id;
END;
$$;