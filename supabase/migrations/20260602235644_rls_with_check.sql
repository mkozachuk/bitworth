-- Phase 5 of testing-critical-path-api-integration
-- Closes the USING-only RLS gap identified in
-- context/foundation/lessons.md "RLS USING-only is not enough for
-- write-scope isolation". The four user-owned policies had
-- USING-only; this migration recreates them with both USING and
-- WITH CHECK clauses. The handler-side `.eq("user_id", user.id)`
-- filter is the first layer; this migration is the second.

BEGIN;

DROP POLICY "Users own their preferences" ON user_preferences;
CREATE POLICY "Users own their preferences" ON user_preferences
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY "Users own their assets" ON assets;
CREATE POLICY "Users own their assets" ON assets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY "Users own their snapshots" ON snapshots;
CREATE POLICY "Users own their snapshots" ON snapshots
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- snapshot_items ownership is transitive via the parent snapshots row.
-- WITH CHECK requires the new item's snapshot_id to belong to the caller,
-- so a future maintainer who inserts items with a foreign snapshot_id
-- belonging to another user fails the policy.
DROP POLICY "Users own their snapshot items" ON snapshot_items;
CREATE POLICY "Users own their snapshot items" ON snapshot_items
  FOR ALL TO authenticated
  USING (snapshot_id IN (SELECT id FROM snapshots WHERE user_id = auth.uid()))
  WITH CHECK (snapshot_id IN (SELECT id FROM snapshots WHERE user_id = auth.uid()));

COMMIT;
