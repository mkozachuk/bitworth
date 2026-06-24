-- Asset balancer (roadmap slice S-15): per-(user, asset) target allocation percentages.
-- Creates the allocation_targets table that backs the "Balance" page. Each row pins a
-- target_pct (0–100 scale, matching the math layer — no ×100/÷100 at the DB boundary)
-- for one of the user's assets.
--
-- Ownership: user-owned, RLS-protected. The policy pairs USING with WITH CHECK
-- (lessons.md "RLS USING-only is not enough for write-scope isolation"), scoped to the
-- authenticated role like the other user-owned tables.
--
-- Cascade: ON DELETE CASCADE from both auth.users and assets, so deleting an asset
-- auto-removes its target (no orphan rows, no compensating delete needed).
--
-- Idempotent upserts: UNIQUE(user_id, asset_id) enables
-- .upsert(rows, { onConflict: "user_id,asset_id" }) as a single atomic statement.
--
-- Reuses the shared update_updated_at() trigger from the initial schema.
--
-- Rollback: DROP TABLE allocation_targets;

BEGIN;

CREATE TABLE allocation_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  target_pct NUMERIC(5, 2) NOT NULL CHECK (target_pct >= 0 AND target_pct <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset_id)
);

CREATE INDEX idx_allocation_targets_user_id ON allocation_targets(user_id);

ALTER TABLE allocation_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their allocation targets" ON allocation_targets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER allocation_targets_updated_at BEFORE UPDATE ON allocation_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
