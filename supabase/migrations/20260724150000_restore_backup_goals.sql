-- Extend restore_backup to carry the goals table and the show_goals preference
-- (roadmap slice S-21 / savings-goals; table added in 20260724130000_goals.sql,
-- column in 20260724140000_user_preferences_show_goals.sql).
--
-- Gap being closed: restore_backup whitelists every column it imports, so a new
-- table and a new preference column are invisible to it until they are named
-- here. Without this migration an export carrying goals + show_goals (the
-- backup.ts whitelists land in the same commit) would round-trip to nothing on
-- import: the goals silently discarded, the toggle silently reset.
--
-- show_goals is listed in BOTH the INSERT column list and the ON CONFLICT DO
-- UPDATE SET. The prefs row always exists, so the INSERT branch is the one that
-- never runs on a real restore — a column present in the INSERT list but absent
-- from the upsert branch keeps the stale value forever. That is the exact shape
-- of the bug that shipped three times (show_fire_dashboard/show_drift_alerts,
-- metal_symbol, show_trajectory), each time fixed by a follow-up migration.
--
-- show_goals is NOT NULL DEFAULT TRUE, so a lower-version backup that omits it
-- COALESCEs to TRUE rather than violating NOT NULL — the same re-default pattern
-- the other three toggles use. schemaVersion 1 files carry no `goals` key at
-- all; `p_data->'goals'` is then SQL NULL and jsonb_populate_recordset yields
-- zero rows, so the insert is a no-op (backup.ts also normalises the absent
-- array to `[]` before it ever reaches here).
--
-- goals owns its user_id directly (unlike snapshot_items), so it is deleted by
-- user_id in `replace` mode and stamped with v_user on insert; prepareForImport
-- drops both `id` and `user_id`, so `id` falls through to the column default.
--
-- Everything else (search_path, SECURITY DEFINER ownership boundary, delete
-- ordering, the assets/snapshots/snapshot_items inserts) is unchanged from
-- 20260724120000_restore_backup_show_trajectory.sql.

BEGIN;

CREATE OR REPLACE FUNCTION restore_backup(p_mode text, p_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'restore_backup: no authenticated user';
  END IF;

  IF p_mode NOT IN ('replace', 'merge') THEN
    RAISE EXCEPTION 'restore_backup: invalid mode %', p_mode;
  END IF;

  -- replace: clear the caller's rows, children first. user_preferences is the
  -- 1:1 PK-on-user row (upserted below), never deleted.
  IF p_mode = 'replace' THEN
    DELETE FROM snapshot_items
      WHERE snapshot_id IN (SELECT id FROM snapshots WHERE user_id = v_user);
    DELETE FROM snapshots WHERE user_id = v_user;
    DELETE FROM assets WHERE user_id = v_user;
    DELETE FROM goals WHERE user_id = v_user;
  END IF;

  -- user_preferences: upsert the single row on its PK (user_id). Both modes.
  INSERT INTO user_preferences (
    user_id,
    display_currency,
    theme,
    fire_annual_expenses,
    fire_annual_income,
    fire_barista_income,
    fire_current_age,
    fire_expected_return,
    fire_inflation_rate,
    fire_safe_withdrawal_rate,
    fire_starting_principal_override,
    fire_traditional_retirement_age,
    show_fire_dashboard,
    show_drift_alerts,
    show_goals,
    show_trajectory,
    created_at,
    updated_at
  )
  SELECT
    v_user,
    COALESCE(r.display_currency, 'USD'),
    COALESCE(r.theme, 'system'),
    r.fire_annual_expenses,
    r.fire_annual_income,
    r.fire_barista_income,
    r.fire_current_age,
    r.fire_expected_return,
    r.fire_inflation_rate,
    COALESCE(r.fire_safe_withdrawal_rate, 0.04),
    r.fire_starting_principal_override,
    COALESCE(r.fire_traditional_retirement_age, 65),
    COALESCE(r.show_fire_dashboard, true),
    COALESCE(r.show_drift_alerts, true),
    COALESCE(r.show_goals, true),
    COALESCE(r.show_trajectory, true),
    COALESCE(r.created_at, now()),
    COALESCE(r.updated_at, now())
  FROM jsonb_populate_recordset(null::user_preferences, p_data->'user_preferences') AS r
  ON CONFLICT (user_id) DO UPDATE SET
    display_currency = EXCLUDED.display_currency,
    theme = EXCLUDED.theme,
    fire_annual_expenses = EXCLUDED.fire_annual_expenses,
    fire_annual_income = EXCLUDED.fire_annual_income,
    fire_barista_income = EXCLUDED.fire_barista_income,
    fire_current_age = EXCLUDED.fire_current_age,
    fire_expected_return = EXCLUDED.fire_expected_return,
    fire_inflation_rate = EXCLUDED.fire_inflation_rate,
    fire_safe_withdrawal_rate = EXCLUDED.fire_safe_withdrawal_rate,
    fire_starting_principal_override = EXCLUDED.fire_starting_principal_override,
    fire_traditional_retirement_age = EXCLUDED.fire_traditional_retirement_age,
    show_fire_dashboard = EXCLUDED.show_fire_dashboard,
    show_drift_alerts = EXCLUDED.show_drift_alerts,
    show_goals = EXCLUDED.show_goals,
    show_trajectory = EXCLUDED.show_trajectory,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

  -- assets: id/user_id dropped by prepareForImport; user_id stamped here.
  INSERT INTO assets (
    user_id,
    category_id,
    name,
    amount,
    currency,
    crypto_symbol,
    metal_symbol,
    notes,
    quantity,
    show_on_chart,
    created_at,
    updated_at
  )
  SELECT
    v_user,
    r.category_id,
    r.name,
    r.amount,
    r.currency,
    r.crypto_symbol,
    r.metal_symbol,
    r.notes,
    r.quantity,
    COALESCE(r.show_on_chart, false),
    COALESCE(r.created_at, now()),
    COALESCE(r.updated_at, now())
  FROM jsonb_populate_recordset(null::assets, p_data->'assets') AS r;

  -- snapshots: id already regenerated by prepareForImport; user_id stamped here.
  INSERT INTO snapshots (
    id,
    user_id,
    total_net_worth,
    display_currency,
    base_currency,
    source,
    note,
    created_at
  )
  SELECT
    r.id,
    v_user,
    r.total_net_worth,
    r.display_currency,
    COALESCE(r.base_currency, 'USD'),
    r.source,
    r.note,
    COALESCE(r.created_at, now())
  FROM jsonb_populate_recordset(null::snapshots, p_data->'snapshots') AS r;

  -- snapshot_items last: snapshot_id already remapped to the new parents by
  -- prepareForImport. Owned transitively via snapshot_id; no user_id column.
  INSERT INTO snapshot_items (
    snapshot_id,
    category_id,
    name,
    original_amount,
    original_currency,
    converted_amount,
    display_currency,
    exchange_rate_usd,
    display_order,
    created_at
  )
  SELECT
    r.snapshot_id,
    r.category_id,
    r.name,
    r.original_amount,
    r.original_currency,
    r.converted_amount,
    r.display_currency,
    r.exchange_rate_usd,
    COALESCE(r.display_order, 0),
    COALESCE(r.created_at, now())
  FROM jsonb_populate_recordset(null::snapshot_items, p_data->'snapshot_items') AS r;

  -- goals: id/user_id dropped by prepareForImport; user_id stamped here. No FK
  -- to any other backed-up table, so ordering against the inserts above is free.
  INSERT INTO goals (
    user_id,
    name,
    kind,
    category_id,
    target_amount,
    target_currency,
    target_date,
    created_at,
    updated_at
  )
  SELECT
    v_user,
    r.name,
    r.kind,
    r.category_id,
    r.target_amount,
    r.target_currency,
    r.target_date,
    COALESCE(r.created_at, now()),
    COALESCE(r.updated_at, now())
  FROM jsonb_populate_recordset(null::goals, p_data->'goals') AS r;
END;
$$;

COMMIT;
