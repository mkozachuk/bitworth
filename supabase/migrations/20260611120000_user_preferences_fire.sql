-- Adds FIRE calculator input columns to user_preferences (roadmap slice S-09).
-- Persists a single per-user scenario for the /dashboard/fire calculator.
-- Inherits user_preferences RLS, the on_auth_user_created auto-create trigger,
-- and the updated_at trigger. SWR and traditional retirement age get non-null
-- defaults (every existing row backfills to them); the rest are nullable-until-set.
-- NUMERIC(18,2) is the project money convention (assets.amount); NUMERIC(5,4)
-- holds a rate in [0,1] with 4 decimal places (e.g. 0.0725 = 7.25%).
-- CHECK constraints mirror the API range bounds where they express cleanly in SQL.

BEGIN;

ALTER TABLE user_preferences
  ADD COLUMN fire_current_age INTEGER
    CHECK (fire_current_age IS NULL OR (fire_current_age >= 0 AND fire_current_age <= 120)),
  ADD COLUMN fire_annual_income NUMERIC(18, 2)
    CHECK (fire_annual_income IS NULL OR fire_annual_income >= 0),
  ADD COLUMN fire_annual_expenses NUMERIC(18, 2)
    CHECK (fire_annual_expenses IS NULL OR fire_annual_expenses >= 0),
  ADD COLUMN fire_expected_return NUMERIC(5, 4)
    CHECK (fire_expected_return IS NULL OR (fire_expected_return >= 0 AND fire_expected_return <= 1)),
  ADD COLUMN fire_inflation_rate NUMERIC(5, 4)
    CHECK (fire_inflation_rate IS NULL OR (fire_inflation_rate >= 0 AND fire_inflation_rate <= 1)),
  ADD COLUMN fire_safe_withdrawal_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.04
    CHECK (fire_safe_withdrawal_rate > 0 AND fire_safe_withdrawal_rate <= 1),
  ADD COLUMN fire_starting_principal_override NUMERIC(18, 2)
    CHECK (fire_starting_principal_override IS NULL OR fire_starting_principal_override >= 0),
  ADD COLUMN fire_traditional_retirement_age INTEGER NOT NULL DEFAULT 65
    CHECK (fire_traditional_retirement_age >= 0 AND fire_traditional_retirement_age <= 120),
  ADD COLUMN fire_barista_income NUMERIC(18, 2)
    CHECK (fire_barista_income IS NULL OR fire_barista_income >= 0);

COMMIT;
