-- Adds the dashboard net-worth-projection (trajectory) visibility flag to user_preferences (roadmap slice net-worth-trajectory).
-- A NOT NULL DEFAULT TRUE column so existing rows are valid immediately and the
-- dashboard default (projection enabled) is the column default. No backfill.
-- Mirrors the show_drift_alerts / show_fire_dashboard precedent (DEFAULT TRUE) —
-- existing users see the net-worth projection enabled by default, matching the
-- intended behavior.
-- Inherits user_preferences RLS, the on_auth_user_created auto-create trigger,
-- and the updated_at trigger. Rollback is a single DROP COLUMN.

BEGIN;

ALTER TABLE user_preferences ADD COLUMN show_trajectory BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
