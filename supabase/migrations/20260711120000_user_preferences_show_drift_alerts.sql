-- Adds the dashboard allocation-drift-alert visibility flag to user_preferences (roadmap slice S-18).
-- A NOT NULL DEFAULT TRUE column so existing rows are valid immediately and the
-- dashboard default (drift-alert card enabled) is the column default. No backfill.
-- Mirrors the show_fire_dashboard precedent (DEFAULT TRUE) — existing users see
-- the drift-alert logic enabled by default, matching the intended behavior.
-- Inherits user_preferences RLS, the on_auth_user_created auto-create trigger,
-- and the updated_at trigger. Rollback is a single DROP COLUMN.

BEGIN;

ALTER TABLE user_preferences ADD COLUMN show_drift_alerts BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
