---
project: "BitWorth"
context_type: greenfield
created: 2026-05-19
updated: 2026-05-19
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 4.5, 5, 6, 7]
  gray_areas_resolved:
    - topic: primary audience
      decision: "Alex — individual user, privacy-first, desktop-first, manual input"
    - topic: pain category
      decision: "workflow friction + missing capability (spreadsheets lack UX and visualization)"
    - topic: insight
      decision: "Spreadsheets work but lack UX, visualization, and trend tracking. No bank connections — fully manual, privacy-first."
    - topic: base currency
      decision: "User-configurable (PLN, USD, EUR)"
    - topic: target audience
      decision: "Multi-user (isolated accounts, no shared data — each user has their own account)"
    - topic: auth strategy
      decision: "Email + password login; flat user model; landing page + demo mode for unauthenticated users"
    - topic: auth scope
      decision: "Demo mode available without login — pre-populated sample data to showcase the app; demoted to nice-to-have"
    - topic: timeline
      decision: "Scoped down to 3 weeks. FIRE calculator dropped for v1 (noted as future feature). Live crypto pricing kept. Line chart kept."
    - topic: non-goals
      decision: "No FIRE calculator v1, no bank integrations, no shared accounts, no native mobile app, no data export, no inflation adjustment, no currency history"
  frs_drafted: 20
  quality_check_status: accepted
---

# Shape Notes: BitWorth — Net Worth Tracker

## Vision & Problem Statement

Alex, a privacy-conscious individual, maintains a monthly spreadsheet tracking their net worth across cash accounts, investment funds, bonds, and crypto in multiple currencies. The spreadsheet works but lacks polish — it's error-prone, requires manual formula updates, and offers no visual trend tracking. Each month the ritual is the same: open the spreadsheet, copy last month's template, update numbers, manually convert currencies, and try to remember whether the result looks right.

The core insight is that net worth tracking doesn't need bank connections to be useful — the person already knows their balances. The value is in consolidating disparate numbers into one view, with automatic currency conversion and visual history that a spreadsheet can't provide without complex setup.

## User & Persona

### Primary persona: Alex

**Who:** An individual who tracks their personal finances manually. Comfortable with spreadsheets but frustrated by their limitations. Values privacy — no desire to connect bank accounts or give third-party services access to financial data. Has assets across multiple currencies (PLN, USD, EUR), investment accounts, crypto, and possibly hard assets.

**Moment:** Once a month (or when reviewing finances), Alex opens a tool to enter current balances across all accounts. They want to see their total net worth — in their chosen display currency — with comparison to last month and the beginning of the year.

**Cost today:** Spreadsheet maintenance is manual, error-prone, and visually flat. Currency conversion requires external tools. Trends require manual graphing. The process works but feels clunky compared to what a purpose-built tool could deliver.

## Access Control

Users authenticate via email + password. Each user has an isolated account — no shared data, no team workspaces. Flat user model: all authenticated users have identical capabilities. No roles, no admin/member separation. New users sign up with email + password; existing users sign in with email + password. Unauthenticated users see a landing page with auth options (sign up / sign in). A demo mode with pre-populated sample data is available without login — it showcases the app's capabilities without requiring an account. Demo mode is a nice-to-have, not a blocker.

## Success Criteria

### Primary

- User can sign up, log in, and see their dashboard.
- User can add/edit/delete asset entries across all categories with amounts in PLN/USD/EUR.
- User sees a single total net worth number in their chosen display currency, with delta indicators vs. last month and vs. January 1st.
- User sees a line chart of net worth over time (all saved monthly snapshots).

### Secondary

- Live crypto pricing auto-fetches BTC/ETH prices.
- FIRE calculator is a planned future feature (not in MVP scope).

### Guardrails

- No financial data from any user is accessible to other users — strict account isolation.
- External API calls (exchange rates, crypto prices) fail gracefully with fallback values — no broken UI.

## Functional Requirements

### Authentication

- FR-001: Visitor can view a landing page with sign up and sign in options. Priority: must-have
- FR-002: Visitor can run the app in demo mode with pre-populated sample data, without creating an account. Priority: nice-to-have
  > Socrates: Counter-argument considered: "Demo mode with realistic sample data adds implementation complexity for a non-authenticated user." Resolution: demoted to nice-to-have — valuable for visitor evaluation but not blocking the MVP core.
- FR-003: User can sign up with email and password. Priority: must-have
- FR-004: User can sign in with email and password. Priority: must-have
- FR-005: Unauthenticated users cannot access any authenticated route or data. Priority: must-have

### Asset Management

- FR-006: User can add an asset entry with a name, amount, currency (PLN/USD/EUR), and category. Priority: must-have
- FR-007: User can edit an existing asset entry (name, amount, currency, category). Priority: must-have
- FR-008: User can delete an asset entry. Priority: must-have
- FR-009: Asset entries belong to one of these categories: Checking Account, Savings Account, Business/FOP Account, Cash on Hand, Stocks, Investment Funds, Bonds, Crypto, Precious Metals, Real Estate, Vehicles & Valuables, Loans & Credit, P2P/Loans Given. Priority: must-have
- FR-010: Liabilities (Loans & Credit) are treated as negative values when calculating net worth. Priority: must-have

### Net Worth Display

- FR-011: User can set their display currency (PLN, USD, or EUR). All totals are shown in this currency. Priority: must-have
- FR-012: The app fetches live exchange rates and converts all asset amounts to the display currency. Priority: must-have
- FR-013: If exchange rate fetching fails, the app falls back to a cached rate or a manual entry — no broken UI. Priority: must-have
- FR-014: The app displays total net worth as a single number: sum of all assets minus sum of all liabilities, in display currency. Priority: must-have
- FR-015: The app displays delta indicators: net worth vs. last month's snapshot and vs. January 1st, as both absolute value and percentage. Priority: must-have

### Historical Data & Snapshots

- FR-016: The app auto-saves a snapshot once per calendar month. Priority: must-have
- FR-017: User can manually trigger a snapshot save at any time. Priority: must-have
- FR-018: The app displays a line chart showing net worth at each saved snapshot over time. Priority: must-have

### Crypto Pricing

- FR-019: When user enters a crypto asset, the app auto-fetches current market price for BTC, ETH, and common altcoins. Priority: must-have
- FR-020: If crypto price fetching fails, the app falls back to a cached price or manual entry — no broken UI. Priority: must-have

## User Stories

### US-01: User tracks net worth end-to-end

- **Given** Alex has just signed up and logged in
- **When** they set their display currency, add asset entries across multiple categories and currencies, and save a snapshot
- **Then** they see their total net worth in their chosen currency, with delta indicators vs. last month and vs. January 1st, and a line chart that includes the new snapshot

#### Acceptance Criteria

- Total net worth is a single, prominently displayed number
- Each asset category shows its subtotal in the display currency
- The line chart updates to include the new snapshot immediately after saving
- Delta indicators show both absolute and percentage change from the two reference points

### US-02: Visitor explores the app without an account

- **Given** a visitor who has not signed up
- **When** they open the landing page
- **Then** they see an option to explore the app in demo mode with sample data, and an option to sign up

#### Acceptance Criteria

- Demo mode is accessible without any login or account creation
- Demo data is clearly labeled as sample data
- Demo mode shows a realistic set of assets, snapshots, and chart data

### US-03: User manages assets across categories and currencies

- **Given** Alex has assets in PLN, USD, and EUR across checking, investment, and crypto accounts
- **When** they add each asset with its name, amount, currency, and category
- **Then** each asset appears under its category, with its original amount shown, and the totals are correctly converted to their chosen display currency

#### Acceptance Criteria

- Assets are grouped under their category in the UI
- Each asset shows name, amount, and original currency
- Crypto assets trigger a live price fetch on entry
- Net worth total always reflects the sum converted to display currency

## Business Logic

The app computes and displays the user's net worth by converting all assets and liabilities from their original currencies into a single display currency using live exchange rates, then subtracting total liabilities from total assets, while also tracking deltas against historical snapshots to show wealth trends over time.

Inputs the user provides: individual asset entries (name, amount, currency, category), chosen display currency, manual snapshot triggers. Output: a single net worth number, delta indicators, and a historical trend chart. The user encounters this rule every time they open the dashboard — the total is always current, always in one currency, always compared to history.

## Non-Functional Requirements

- A user opening the app sees their net worth number within 2 seconds of page load.
- A user performing any action (add asset, save snapshot, change currency) sees feedback within 500 ms.
- All financial data belonging to a user is strictly private to that user's account — no cross-user data exposure of any kind.
- External API calls (exchange rates, crypto prices) fail gracefully with cached or fallback values — no broken or blank UI under any API failure condition.
- The product remains usable on the latest two major versions of Chrome, Firefox, Safari, and Edge on desktop.

## Non-Goals

- **No FIRE calculator in v1.** FIRE calculator is a planned future feature, prioritized after core MVP features are shipped. Rationale: keeps MVP scope focused on the core net worth tracking loop.
- **No bank or broker integrations.** All asset input is manual. Rationale: preserves privacy, eliminates integration complexity, and keeps the app simple.
- **No shared accounts or team features.** Each user has one isolated account. Rationale: aligns with the individual, privacy-first use case.
- **No native mobile app.** Web app only, responsive for desktop. Rationale: desktop is the primary interaction surface; keeps scope tight.
- **No data export (PDF, CSV, etc.).** No export functionality in MVP. Rationale: out of scope for the core loop.
- **No inflation-adjusted calculations.** Raw net worth only. Rationale: simplifies calculation logic for v1.
- **No currency history.** Exchange rates are used for conversion but not stored as historical time series. Rationale: snapshot values are stored with converted amounts, so the conversion rate at snapshot time is captured implicitly.

## Open Questions

1. **Demo mode scope** — Demo mode is marked nice-to-have. If time permits, what sample data should it include? (Owner: user, by: before implementation)
2. **Exchange rate API** — Which free public API for exchange rates? (Owner: user, by: before implementation) Popular options: exchangerate.host, frankfurter.app, Open Exchange Rates (free tier).
3. **Crypto price API** — Which free public API for crypto prices? (Owner: user, by: before implementation) Popular options: CoinGecko (free, no key), CoinCap, CryptoCompare.
4. **Snapshot auto-save trigger** — Should auto-save trigger on first login each calendar month, or on a fixed day-of-month (e.g., 1st of each month)? (Owner: user, by: before implementation)
5. **Display currency persistence** — Does the display currency preference persist per user across sessions? (Owner: user, by: before implementation)

## Forward: tech-stack

Stack preferences (collected from user during shaping, informational only — not part of PRD schema):

- No specific framework preference mentioned yet — to be determined in tech-stack-selection.
- Target: web app (browser-based).
- After-hours development only.
