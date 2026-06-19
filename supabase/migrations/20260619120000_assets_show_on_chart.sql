-- Adds the per-asset opt-in flag for the Asset Trends chart (roadmap slice S-12).
-- A NOT NULL DEFAULT FALSE column so existing rows are valid immediately and the
-- dashboard default (hidden / not on chart) is the column default. No backfill.
-- No RLS change needed: the assets row-scoped policy already pairs USING with
-- WITH CHECK (20260602235644_rls_with_check.sql), so the new column inherits it.
-- Rollback is a single DROP COLUMN.

BEGIN;

ALTER TABLE assets ADD COLUMN show_on_chart BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
