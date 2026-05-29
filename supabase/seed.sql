-- Asset category seed data (Phase 2)
-- 13 categories from FR-009, in display order

BEGIN;

INSERT INTO asset_categories (id, name, icon, is_liability, display_order) VALUES
  ('checking_account', 'Checking Account', 'wallet', false, 1),
  ('savings_account', 'Savings Account', 'piggy-bank', false, 2),
  ('business_fop', 'Business/FOP Account', 'briefcase', false, 3),
  ('cash_on_hand', 'Cash on Hand', 'banknote', false, 4),
  ('stocks', 'Stocks', 'trending-up', false, 5),
  ('investment_funds', 'Investment Funds', 'bar-chart-2', false, 6),
  ('bonds', 'Bonds', 'shield', false, 7),
  ('crypto', 'Crypto', 'bitcoin', false, 8),
  ('precious_metals', 'Precious Metals', 'gem', false, 9),
  ('real_estate', 'Real Estate', 'home', false, 10),
  ('vehicles_valuables', 'Vehicles & Valuables', 'car', false, 11),
  ('loans_credit', 'Loans & Credit', 'credit-card', true, 12),
  ('p2p_loans', 'P2P/Loans Given', 'hand-coins', false, 13);

COMMIT;