-- Extend restore_backup to carry the assets.sort_order column (roadmap slice
-- S-25; column added in 20260727120000_assets_sort_order.sql).
--
-- Gap being closed: restore_backup whitelists every column it imports, so a new
-- assets column is invisible to it until it is named here. Without this migration
-- the column exports fine (backup.ts's ASSETS_COLUMNS lands in the same commit)
-- and is silently discarded on import — the user's carefully arranged order
-- survives the export and evaporates on restore. That is the exact bug the
-- metal_symbol migration exists to fix, and it has now shipped three times
-- (show_fire_dashboard/show_drift_alerts, metal_symbol, show_trajectory);
-- src/lib/backup-rpc-parity.test.ts turns the fourth occurrence into a red run.
--
-- sort_order is NOT NULL DEFAULT 0, so a backup exported BEFORE this change —
-- which carries no sort_order key at all — COALESCEs to 0 rather than violating
-- NOT NULL, mirroring how show_on_chart is handled below. Every restored asset
-- then shares sort_order 0, and the `created_at DESC` tiebreak on both ordered
-- read paths reproduces exactly today's newest-first order. CURRENT_SCHEMA_VERSION
-- deliberately stays at 2: adding a column to an existing table is the
-- metal_symbol/show_on_chart case, not the goals case.
--
-- Everything else (search_path, SECURITY DEFINER ownership boundary, delete
-- ordering, the other four inserts) is unchanged from
-- 20260724150000_restore_backup_goals.sql.

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
