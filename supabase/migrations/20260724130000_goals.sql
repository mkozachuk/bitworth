-- Custom savings goals (roadmap slice S-21): named, user-owned savings targets.
-- Each row is one goal — either against total net worth ("reach EUR 1M") or against a
-- single asset category ("Savings Account -> EUR 50k emergency fund").
--
-- Ownership: user-owned, RLS-protected. The policy pairs USING with WITH CHECK
-- (lessons.md "RLS USING-only is not enough for write-scope isolation"), scoped to the
-- authenticated role like the other user-owned tables.
--
-- kind/category_id coherence: a 'category' goal must name a category, a 'net_worth' goal
-- must not. That CHECK is why goals_category_id_fkey carries no ON DELETE clause —
-- ON DELETE SET NULL would produce a row violating the CHECK, so the FK would behave as
-- RESTRICT anyway. This mirrors assets.category_id, which is likewise clause-free.
-- asset_categories is seeded and immutable, so the restriction never fires in practice.
--
-- Currency and amount CHECKs follow the repo idiom: TEXT + inline CHECK, no Postgres
-- enums (initial_schema.sql:34,48).
--
-- Reuses the shared update_updated_at() trigger from the initial schema.
--
-- Rollback: see the commented block at the bottom.

BEGIN;

CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('net_worth', 'category')),
  category_id TEXT REFERENCES asset_categories(id),
  target_amount NUMERIC(18, 2) NOT NULL CHECK (target_amount > 0),
  target_currency TEXT NOT NULL CHECK (target_currency IN ('PLN', 'USD', 'EUR')),
  target_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (kind = 'category' AND category_id IS NOT NULL) OR
    (kind = 'net_worth' AND category_id IS NULL)
  )
);

CREATE INDEX idx_goals_user_id ON goals(user_id);

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their goals" ON goals
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER goals_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

-- Rollback:
--   DROP TABLE goals;
