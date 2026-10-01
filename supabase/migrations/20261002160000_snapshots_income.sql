-- Income per snapshot interval (BitWorth slice B2, roadmap S-24, R1).
-- Adds one nullable column:
--   snapshots.income NUMERIC(18,2)  the income earned in the interval that ends
--                                   at this snapshot, the same interval basis as
--                                   net_contribution, stored in this snapshot's
--                                   display_currency (net_contribution's
--                                   convention).
--
-- NULL means "not recorded" and is distinct from 0: the savings rate
-- (src/lib/savings-rate.ts) is unknown for a NULL income, and also for 0, since
-- a rate over zero income is undefined. No default and no backfill: every row
-- saved before this migration stays NULL. Income cannot be negative; the CHECK
-- says so in the database too, not only in the API.
--
-- Ownership is unchanged: snapshots is owned through user_id (existing RLS).
--
-- Backups: exported with the row; restored by
-- 20261002170000_restore_backup_income.sql, which must be applied after this.
--
-- Rollback (re-apply 20261002150000_restore_backup_tag_ids.sql first, so
-- restore_backup no longer writes the column):
--   ALTER TABLE snapshots DROP COLUMN income;

BEGIN;

ALTER TABLE snapshots ADD COLUMN income NUMERIC(18,2);

ALTER TABLE snapshots
  ADD CONSTRAINT snapshots_income_non_negative
  CHECK (income IS NULL OR income >= 0);

COMMIT;
