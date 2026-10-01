-- Asset tags (BitWorth feature idea "custom tags for assets", slice B1a).
-- Creates two user-owned tables:
--   tags        one row per user-defined tag. The name is unique per user
--               regardless of case (unique index on (user_id, lower(name))), and
--               show_on_dashboard is the per-tag "chart on dashboard" toggle.
--   asset_tags  the many-to-many link between assets and tags, keyed on
--               (asset_id, tag_id). Deleting either side cascades the link away,
--               so no compensating delete is ever needed.
--
-- Ownership: both tables carry user_id and are RLS-protected with USING + WITH
-- CHECK auth.uid() = user_id, scoped to the authenticated role, the same
-- pattern as allocation_targets/allocation_cards. A foreign key is checked
-- without RLS, so the API also verifies that the asset and every tag in a link
-- belong to the caller before writing one.
--
-- The name CHECK mirrors the API validation (trimmed, 1-32 characters) as a
-- backstop. btrim() only strips spaces, so it never rejects a name the API's
-- trim() accepted.
--
-- Backups: both tables join the backup envelope (schemaVersion 4) and are
-- restored by 20261002130000_restore_backup_tags.sql, which must be applied
-- after this file.
--
-- Reuses the shared update_updated_at() trigger from the initial schema.
--
-- Rollback (restore_backup must first be redeclared without the tag tables,
-- i.e. re-apply 20261001130000_restore_backup_allocation.sql):
--   DROP TABLE asset_tags;
--   DROP TABLE tags;

BEGIN;

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 32),
  show_on_dashboard BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE(user_id, lower(name)): an expression needs a unique index, not a
-- table constraint. It also serves the per-user lookups.
CREATE UNIQUE INDEX tags_user_id_lower_name_key ON tags (user_id, lower(name));

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their tags" ON tags
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER tags_updated_at BEFORE UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE asset_tags (
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (asset_id, tag_id)
);

CREATE INDEX idx_asset_tags_tag_id ON asset_tags(tag_id);
CREATE INDEX idx_asset_tags_user_id ON asset_tags(user_id);

ALTER TABLE asset_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their asset tags" ON asset_tags
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;
