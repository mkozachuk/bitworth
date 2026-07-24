-- Adds the dashboard savings-goals card visibility flag to user_preferences (roadmap slice S-21).
-- A NOT NULL DEFAULT TRUE column so existing rows are valid immediately and the
-- dashboard default (goals card enabled) is the column default. No backfill.
-- Mirrors the show_drift_alerts / show_fire_dashboard / show_trajectory precedent
-- (DEFAULT TRUE) — existing users see the goals card enabled by default.
-- Inherits user_preferences RLS, the on_auth_user_created auto-create trigger,
-- and the updated_at trigger. Rollback is a single DROP COLUMN.

BEGIN;

ALTER TABLE user_preferences ADD COLUMN show_goals BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;

-- Rollback:
--   ALTER TABLE user_preferences DROP COLUMN show_goals;
