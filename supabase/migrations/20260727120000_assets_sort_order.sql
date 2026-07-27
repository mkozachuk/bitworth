-- Adds the user-controlled row order for the assets list (roadmap slice S-25).
-- A NOT NULL DEFAULT 0 column so existing rows are valid immediately, plus a
-- per-user backfill that seeds today's visible order (created_at DESC) — the
-- migration is therefore invisible to users: the list looks exactly the same the
-- moment it lands.
--
-- sort_order alone is NOT a total order (two rows can share a value, and every
-- row shares 0 after restoring a pre-sort_order backup), so every ordered read
-- must be `.order("sort_order", asc).order("created_at", desc)`. The created_at
-- tiebreak is what makes the order deterministic and makes a sort_order-less
-- backup degrade gracefully to today's behavior instead of an arbitrary shuffle.
--
-- The trigger dance is the non-obvious part: assets_updated_at is a BEFORE
-- UPDATE ... FOR EACH ROW trigger that unconditionally stamps updated_at =
-- NOW(). Without disabling it, this backfill would rewrite every asset's
-- updated_at on deploy — and since updated_at is in ASSETS_COLUMNS, it would
-- churn every backup export too. Disabling is acceptable HERE because the
-- migration transaction already holds an ACCESS EXCLUSIVE lock from the
-- ALTER TABLE above. It is NOT acceptable at runtime — the reorder_assets RPC
-- must never disable a trigger; it avoids the bump with `IS DISTINCT FROM`.
--
-- No RLS change needed: the assets row-scoped policy already pairs USING with
-- WITH CHECK (20260602235644_rls_with_check.sql), so the new column inherits it.
-- Rollback is `DROP INDEX idx_assets_user_sort; ALTER TABLE assets DROP COLUMN
-- sort_order;` — but note both ordered read paths reference sort_order, so a
-- rollback must revert the application code too.

BEGIN;

ALTER TABLE assets ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE assets DISABLE TRIGGER assets_updated_at;

UPDATE assets a
SET sort_order = t.rn
FROM (
  SELECT id,
         (row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) - 1)::int AS rn
  FROM assets
) t
WHERE a.id = t.id;

ALTER TABLE assets ENABLE TRIGGER assets_updated_at;

-- Covers the new read order so neither ordered read regresses to a sort.
CREATE INDEX idx_assets_user_sort ON assets(user_id, sort_order, created_at DESC);

COMMIT;
