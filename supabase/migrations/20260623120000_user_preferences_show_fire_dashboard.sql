-- Adds the dashboard FIRE-card visibility flag to user_preferences (roadmap slice S-14).
-- A NOT NULL DEFAULT TRUE column so existing rows are valid immediately and the
-- dashboard default (FIRE card visible) is the column default. No backfill.
-- Note: unlike the show_on_chart precedent (DEFAULT FALSE), this defaults TRUE —
-- existing users see the FIRE card by default, matching the intended behavior.
-- Inherits user_preferences RLS, the on_auth_user_created auto-create trigger,
-- and the updated_at trigger. Rollback is a single DROP COLUMN.

BEGIN;

ALTER TABLE user_preferences ADD COLUMN show_fire_dashboard BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
