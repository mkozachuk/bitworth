-- Asset balancer multi-card support (follow-up to S-15).
--
-- Introduces named "portfolio cards": each card owns a set of (asset_id, target_pct)
-- rows, and the SAME asset may appear in several cards with different targets (e.g.
-- one card for ETFs, another for bonds + funds). This replaces the single per-user
-- target set with one set per card.
--
-- Migration shape:
--   1. Create allocation_cards (user-owned, RLS, same policy pattern as the other
--      user-owned tables; reuses the shared update_updated_at() trigger).
--   2. Add allocation_targets.card_id (nullable first), backfill every user's existing
--      targets into one default card, then make the column NOT NULL.
--   3. Swap the per-asset uniqueness from (user_id, asset_id) to (card_id, asset_id)
--      so an asset can live in multiple cards. The backfill is safe because each user
--      maps to exactly one card at this point, so no (card_id, asset_id) collisions.
--
-- Rollback: see the commented block at the bottom.

BEGIN;

-- 1. Portfolio cards ----------------------------------------------------------

CREATE TABLE allocation_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_allocation_cards_user_id ON allocation_cards(user_id);

ALTER TABLE allocation_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their allocation cards" ON allocation_cards
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER allocation_cards_updated_at BEFORE UPDATE ON allocation_cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Card membership on allocation_targets ------------------------------------

ALTER TABLE allocation_targets
  ADD COLUMN card_id UUID REFERENCES allocation_cards(id) ON DELETE CASCADE;

-- One default card per user that currently has targets...
INSERT INTO allocation_cards (user_id, name, position)
SELECT DISTINCT user_id, 'My allocation', 0
FROM allocation_targets;

-- ...and move every existing target into that user's (only) card.
UPDATE allocation_targets t
SET card_id = c.id
FROM allocation_cards c
WHERE c.user_id = t.user_id;

ALTER TABLE allocation_targets
  ALTER COLUMN card_id SET NOT NULL;

CREATE INDEX idx_allocation_targets_card_id ON allocation_targets(card_id);

-- 3. Per-card (not per-user) asset uniqueness ---------------------------------

ALTER TABLE allocation_targets
  DROP CONSTRAINT allocation_targets_user_id_asset_id_key;

ALTER TABLE allocation_targets
  ADD CONSTRAINT allocation_targets_card_id_asset_id_key UNIQUE (card_id, asset_id);

COMMIT;

-- Rollback:
--   ALTER TABLE allocation_targets DROP CONSTRAINT allocation_targets_card_id_asset_id_key;
--   ALTER TABLE allocation_targets ADD CONSTRAINT allocation_targets_user_id_asset_id_key UNIQUE (user_id, asset_id);
--   ALTER TABLE allocation_targets DROP COLUMN card_id;
--   DROP TABLE allocation_cards;
