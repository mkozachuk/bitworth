-- Fixes a pre-existing bug: on_auth_user_created is SECURITY DEFINER but
-- does not SET search_path. Postgres defaults SECURITY DEFINER functions to
-- pg_catalog,pg_temp search_path, so unqualified "user_preferences" was
-- invisible inside the function and signup failed with
-- "relation 'user_preferences' does not exist". Recreating the function with
-- an explicit search_path makes it resolve the table in public.

BEGIN;

CREATE OR REPLACE FUNCTION on_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO user_preferences (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

COMMIT;
