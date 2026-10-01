-- Tags recorded at save time on snapshot items (BitWorth slice B1b, T6).
-- Adds one nullable column:
--   snapshot_items.tag_ids uuid[]  the ids of the tags the asset carried when
--                                  the snapshot was saved.
--
-- NULL means "not recorded": every row saved before this migration, and any row
-- written by a client that does not send the column. It is never read as an
-- empty set and is never backfilled. An empty array means "recorded, the asset
-- had no tags". The tag chart (src/lib/tag-trends.ts) relies on that difference.
--
-- An array cannot carry a foreign key, so an id here may outlive its tag (a tag
-- deleted after the snapshot). That is legitimate history; the chart only draws
-- tags that still exist. The CHECK forbids NULL elements, which keeps the
-- restore honest: restore_backup resolves each id through its tag's name and a
-- reference it cannot resolve becomes a NULL element, which this CHECK turns
-- into a rollback instead of a silently shortened array.
--
-- Ownership is unchanged: snapshot_items is owned through snapshot_id.
--
-- Backups: exported with the row; restored by
-- 20261002150000_restore_backup_tag_ids.sql, which must be applied after this.
--
-- Rollback (re-apply 20261002130000_restore_backup_tags.sql first, so
-- restore_backup no longer writes the column):
--   ALTER TABLE snapshot_items DROP COLUMN tag_ids;

BEGIN;

ALTER TABLE snapshot_items ADD COLUMN tag_ids uuid[];

ALTER TABLE snapshot_items
  ADD CONSTRAINT snapshot_items_tag_ids_no_null_elements
  CHECK (tag_ids IS NULL OR array_position(tag_ids, NULL) IS NULL);

COMMIT;
