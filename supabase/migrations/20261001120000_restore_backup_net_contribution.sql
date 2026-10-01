-- Extend restore_backup to carry the snapshots.net_contribution column (roadmap
-- slice S-17; column added in 20260628120000_snapshots_net_contribution.sql).
--
-- Gap being closed: the column was never added to the backup whitelist or to
-- this function, so every export since S-17 dropped it and every restore wrote
-- NULL. src/lib/backup-rpc-parity.test.ts did not catch it because export and
-- import omitted the column together and so agreed with each other; the new
-- src/lib/backup-completeness.test.ts now checks the export whitelist against
-- the table's real columns in database.types.ts.
--
-- net_contribution is nullable with no default, and NULL ("not recorded") is
-- distinct from 0. It is therefore inserted as-is, NOT COALESCEd: a value
-- round-trips exactly, an explicit null stays NULL, and a backup exported before
-- this change (no net_contribution key at all) maps to NULL through
-- jsonb_populate_recordset, which is what that snapshot held anyway.
-- CURRENT_SCHEMA_VERSION stays at 2 (same case as assets.sort_order).
--
-- The only change from 20260727130000_restore_backup_sort_order.sql is the
-- snapshots INSERT column list and its SELECT. Everything else (search_path,
-- SECURITY DEFINER ownership boundary, delete ordering, the other four inserts)
-- is unchanged.

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
  -- sort_order COALESCEs to 0 for pre-S-25 files (see header).
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
    sort_order,
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
    COALESCE(r.sort_order, 0),
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
    net_contribution,
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
    r.net_contribution,
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
