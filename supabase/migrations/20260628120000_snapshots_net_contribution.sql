-- Adds the signed net-contribution captured at/after snapshot save
-- (roadmap slice S-17 contributions-vs-growth). NUMERIC(18,2) to match the
-- existing money columns (e.g. total_net_worth). Nullable with no default:
-- existing snapshots and blank-field saves legitimately have no value, so the
-- column must allow NULL rather than coerce to 0.
-- No RLS change needed: the snapshots row-scoped policy already pairs USING
-- with WITH CHECK (20260602235644_rls_with_check.sql), so the new column
-- inherits it.
-- Rollback is a single DROP COLUMN:
--   ALTER TABLE snapshots DROP COLUMN net_contribution;

BEGIN;

ALTER TABLE snapshots ADD COLUMN net_contribution NUMERIC(18,2);

COMMIT;
