-- Lock down the restore_backup RPC's execute privilege so only the
-- authenticated role can call it. restore_backup is SECURITY DEFINER
-- (bypasses RLS), so making the trust boundary explicit is defense-in-depth
-- on top of the auth.uid() IS NULL raise inside the function.
--
-- NB: Supabase's default privileges grant EXECUTE on new functions directly
-- to anon/authenticated/service_role (not via PUBLIC), so REVOKE FROM PUBLIC
-- alone leaves anon able to execute. Revoke from anon explicitly too.
REVOKE EXECUTE ON FUNCTION restore_backup(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION restore_backup(text, jsonb) TO authenticated;
