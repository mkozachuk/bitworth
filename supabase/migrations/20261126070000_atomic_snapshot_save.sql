-- Atomic, idempotent snapshot save (NB-060, BitWorth C-01 option C).
--
-- POST /api/snapshots used to write the parent `snapshots` row and its
-- `snapshot_items` in two PostgREST calls, with a compensating cleanup call on
-- an items failure. Two gaps followed: a failed cleanup left an orphan parent
-- (lessons.md §"DB multi-table writes must be atomic"), and a double submit
-- (retry after a lost response, a double click) saved the month twice.
--
-- This migration adds three things and nothing else:
--   1. snapshots.client_request_id uuid: nullable, no default, no backfill.
--      The client mints one per save intent. NULL keeps the legacy behaviour
--      (every call creates a snapshot), so every existing row stays valid.
--   2. A partial unique index on (user_id, client_request_id) for non-NULL
--      keys: the same key from the same user can exist once; the same key
--      from two users is two rows.
--   3. create_snapshot(p_snapshot, p_items, p_client_request_id): parent and
--      items in one function call, so one transaction. Any item failure
--      raises and takes the parent with it. A replayed key inserts nothing
--      and returns the existing row with created = false. The replay check is
--      INSERT ... ON CONFLICT DO NOTHING on the partial index, not a select
--      before the insert, so two concurrent calls cannot both create.
--
-- SECURITY INVOKER: RLS on snapshots / snapshot_items applies exactly as for
-- the two direct inserts it replaces. search_path is pinned anyway
-- (lessons.md §"SECURITY DEFINER functions need an explicit `SET search_path`",
-- last paragraph). user_id is auth.uid(), never a parameter: a user_id key in
-- p_snapshot is ignored. Grants mirror 20260727120100_reorder_assets_rpc.sql:
-- Supabase's default privileges grant EXECUTE to anon directly, so the REVOKE
-- names anon as well as PUBLIC.
--
-- Backups do not carry client_request_id (a request key, not user data); see
-- NOT_BACKED_UP in src/lib/backup-completeness.test.ts. restore_backup is not
-- touched: restored rows get NULL, which is the legacy value.
--
-- Additive only. Reverting means removing the function, the index and the
-- column, in that order, after the app no longer calls create_snapshot.

BEGIN;

ALTER TABLE snapshots ADD COLUMN client_request_id uuid;

CREATE UNIQUE INDEX snapshots_user_client_request_id_key
  ON snapshots (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE FUNCTION create_snapshot(p_snapshot jsonb, p_items jsonb, p_client_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row snapshots%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'create_snapshot: no authenticated user';
  END IF;

  INSERT INTO snapshots (user_id, total_net_worth, display_currency, base_currency, source,
                         net_contribution, income, client_request_id)
  VALUES (
    v_user,
    (p_snapshot ->> 'total_net_worth')::numeric,
    p_snapshot ->> 'display_currency',
    coalesce(p_snapshot ->> 'base_currency', 'USD'),
    p_snapshot ->> 'source',
    (p_snapshot ->> 'net_contribution')::numeric,
    (p_snapshot ->> 'income')::numeric,
    p_client_request_id
  )
  ON CONFLICT (user_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Replay: this user already saved with this key. Nothing is written; the
    -- caller gets the row the first call created.
    SELECT * INTO STRICT v_row
    FROM snapshots
    WHERE user_id = v_user AND client_request_id = p_client_request_id;
    RETURN jsonb_build_object('snapshot', to_jsonb(v_row), 'created', false);
  END IF;

  -- An empty or NULL items array leaves the parent alone (the pinned
  -- empty-assets behaviour, lessons.md §"Empty-assets on snapshot POST").
  INSERT INTO snapshot_items (snapshot_id, category_id, name, original_amount, original_currency,
                              converted_amount, display_currency, exchange_rate_usd, display_order, tag_ids)
  SELECT v_row.id, i.category_id, i.name, i.original_amount, i.original_currency,
         i.converted_amount, i.display_currency, i.exchange_rate_usd, i.display_order, i.tag_ids
  FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS i(
    category_id text,
    name text,
    original_amount numeric,
    original_currency text,
    converted_amount numeric,
    display_currency text,
    exchange_rate_usd numeric,
    display_order integer,
    tag_ids uuid[]
  );

  RETURN jsonb_build_object('snapshot', to_jsonb(v_row), 'created', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION create_snapshot(jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_snapshot(jsonb, jsonb, uuid) TO authenticated;

COMMIT;
