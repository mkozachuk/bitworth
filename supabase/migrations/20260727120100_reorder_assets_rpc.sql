-- Atomic reorder for the assets list (roadmap slice S-25).
--
-- Renumbers the caller's assets from an ordered id array in ONE statement, so a
-- partial write is impossible. A loop of per-row UPDATEs (the obvious client-side
-- shape) would leave an order that is neither the old one nor the new one on any
-- mid-flight failure — lessons.md §"DB multi-table writes must be atomic"
-- generalizes here: one statement, or nothing.
--
-- SECURITY DEFINER with an explicit `SET search_path = public, pg_temp`, per
-- lessons.md §"SECURITY DEFINER functions need an explicit `SET search_path`" —
-- the default for a definer function is pg_catalog, pg_temp, so an unqualified
-- `assets` would resolve to nothing. Grants mirror
-- 20260621000000_restore_backup_grants.sql exactly: Supabase's default
-- privileges grant EXECUTE directly to anon/authenticated (not via PUBLIC), so
-- REVOKE FROM PUBLIC alone would leave anon able to call this.
--
-- Every write is scoped to auth.uid(), so a foreign id can never touch another
-- user's row even though the function bypasses RLS.
--
-- Rollback: DROP FUNCTION reorder_assets(uuid[]);

BEGIN;

CREATE OR REPLACE FUNCTION reorder_assets(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  -- array_length is NULL for an empty/NULL array; COALESCE keeps the checks
  -- below returning TRUE/FALSE rather than NULL, so an empty array against a
  -- non-empty account raises instead of silently no-opping.
  v_len int := COALESCE(array_length(p_ids, 1), 0);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'reorder_assets: no authenticated user';
  END IF;

  -- One check covers three failure modes at once: duplicate ids, ids belonging to
  -- another user, and an array that does not cover every asset the caller owns.
  -- Any of those would otherwise leave duplicate or stale sort_order values.
  IF (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> v_len
     OR (SELECT count(*) FROM assets WHERE user_id = v_user AND id = ANY(p_ids)) <> v_len
     OR (SELECT count(*) FROM assets WHERE user_id = v_user) <> v_len
  THEN
    RAISE EXCEPTION 'reorder_assets: id array is not a complete, unique cover of the caller''s assets';
  END IF;

  -- `IS DISTINCT FROM` is what keeps `assets_updated_at` off the untouched rows.
  -- The migration that added sort_order could disable that trigger for its
  -- backfill; a runtime path must not, so it only writes rows that actually move.
  UPDATE assets a
  SET sort_order = n.rn
  FROM (
    SELECT id, (ordinality - 1)::int AS rn
    FROM unnest(p_ids) WITH ORDINALITY AS t(id, ordinality)
  ) n
  WHERE a.id = n.id
    AND a.user_id = v_user
    AND a.sort_order IS DISTINCT FROM n.rn;
END;
$$;

REVOKE EXECUTE ON FUNCTION reorder_assets(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reorder_assets(uuid[]) TO authenticated;

COMMIT;
