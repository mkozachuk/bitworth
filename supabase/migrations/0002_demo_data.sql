-- ============================================================
-- BitWorth MVP: Demo Data Migration
-- ============================================================
-- Creates demo user, demo assets, and 12 monthly snapshots
-- so the demo dashboard has chart data to display.
-- ============================================================

-- Add is_demo column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

-- Create demo profile (user does NOT exist in auth.users,
-- is_demo flag allows the app to load demo data without auth)
INSERT INTO profiles (id, display_currency, is_demo)
VALUES ('00000000-0000-0000-0000-000000000001', 'PLN', true)
ON CONFLICT (id) DO UPDATE SET is_demo = true;

-- Demo assets: 5 assets across different categories and currencies
-- Total (in PLN, assuming approx rates):
--   Checking (PLN): 15,000 PLN
--   Stocks (USD):   3,000 USD  (~12,000 PLN)
--   Crypto (USD):   2,000 USD  (~8,000 PLN)
--   Savings (EUR):  5,000 EUR  (~21,000 PLN)
--   Real Estate:  180,000 PLN
-- Total approx: ~236,000 PLN net worth
INSERT INTO assets (id, user_id, name, amount, currency, category, is_liability)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'PKO Checking', 15000.00, 'PLN', 'Checking Account', false),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Vanguard Brokerage', 3000.00, 'USD', 'Stocks', false),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Bitcoin Holdings', 2000.00, 'USD', 'Crypto', false),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'ING Savings', 5000.00, 'EUR', 'Savings Account', false),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Warsaw Apartment', 180000.00, 'PLN', 'Real Estate', false);

-- Demo snapshots: 12 monthly snapshots for the current year (Jan to current month)
-- Net worth grows steadily over the year, ending around 205,000 PLN
-- Snapshot dates are all set to the 1st of each month
INSERT INTO snapshots (id, user_id, total_net_worth, currency, snapshot_date)
VALUES
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 185000.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '0 month'),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 187500.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 month'),
  ('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 189000.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '2 months'),
  ('b0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 192000.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '3 months'),
  ('b0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 195000.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '4 months'),
  ('b0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 197000.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '5 months'),
  ('b0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 199000.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '6 months'),
  ('b0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', 201000.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '7 months'),
  ('b0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', 202000.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '8 months'),
  ('b0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 203500.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '9 months'),
  ('b0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 204500.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '10 months'),
  ('b0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 205000.00, 'PLN', DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '11 months');


api key 5YZAkRt63YitJqxTMmyomo67Udda7xHFIA3hHCimuh89ok0n2arMcIhSw4HYI2P0
    secret rxmjLMqJsYYQ2dpMm7mK0u5QsTBEfpmsodkIOYpnq32KZUDMGUb8nnL1quvb4KNT