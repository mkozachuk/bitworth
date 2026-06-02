-- Adds theme preference column to user_preferences
-- Supports 'light', 'dark', 'system' (default) for the theme toggle

BEGIN;

ALTER TABLE user_preferences
  ADD COLUMN theme TEXT NOT NULL DEFAULT 'system'
    CHECK (theme IN ('light', 'dark', 'system'));

COMMIT;
