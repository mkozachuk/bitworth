-- Phase 1: Initial schema migration
-- Creates 5 tables: user_preferences, asset_categories, assets,
-- snapshots, snapshot_items, exchange_rate_cache
-- With indexes, constraints, RLS policies, and triggers

BEGIN;

-- user_preferences (1:1 with auth.users)
CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (display_currency IN ('PLN', 'USD', 'EUR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- asset_categories (seeded, immutable after initial seed)
CREATE TABLE asset_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  is_liability BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- assets
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES asset_categories(id),
  name TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('PLN', 'USD', 'EUR')),
  crypto_symbol TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- snapshots
CREATE TABLE snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_net_worth NUMERIC(18, 2) NOT NULL,
  display_currency TEXT NOT NULL CHECK (display_currency IN ('PLN', 'USD', 'EUR')),
  base_currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL CHECK (source IN ('manual', 'auto')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- snapshot_items (itemized asset values at snapshot time)
CREATE TABLE snapshot_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES asset_categories(id),
  name TEXT NOT NULL,
  original_amount NUMERIC(18, 2) NOT NULL,
  original_currency TEXT NOT NULL,
  converted_amount NUMERIC(18, 2) NOT NULL,
  display_currency TEXT NOT NULL,
  exchange_rate_usd NUMERIC(20, 10),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- exchange_rate_cache
CREATE TABLE exchange_rate_cache (
  base_currency TEXT NOT NULL,
  target_currency TEXT NOT NULL,
  rate NUMERIC(20, 10) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (base_currency, target_currency)
);

-- Indexes for common query patterns
CREATE INDEX idx_assets_user_id ON assets(user_id);
CREATE INDEX idx_assets_user_category ON assets(user_id, category_id);
CREATE INDEX idx_snapshots_user_id ON snapshots(user_id);
CREATE INDEX idx_snapshots_user_created ON snapshots(user_id, created_at DESC);
CREATE INDEX idx_snapshot_items_snapshot_id ON snapshot_items(snapshot_id);

-- Enable RLS on all tables
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rate_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users own their preferences" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their assets" ON assets
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their snapshots" ON snapshots
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their snapshot items" ON snapshot_items
  FOR ALL USING (
    snapshot_id IN (SELECT id FROM snapshots WHERE user_id = auth.uid())
  );

CREATE POLICY "Anyone can read exchange rates" ON exchange_rate_cache
  FOR SELECT USING (true);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assets_updated_at BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_prefs_updated_at BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: create user_preferences on auth.users insert
CREATE OR REPLACE FUNCTION on_auth_user_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_preferences (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_users_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION on_auth_user_created();

COMMIT;