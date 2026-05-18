---
project: "Bitworth"
version: 1
status: draft
created: 2026-05-18
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# Bitworth — Product Requirements Document

## Vision & Problem Statement

Anyone who manually tracks their personal finances in a spreadsheet faces a painful monthly ritual: copying balances from cash accounts in multiple currencies, investment portfolios, bonds, and crypto holdings into one place, converting everything to a single currency by hand, and calculating a total net worth that they then have to rebuild from scratch the next month. The spreadsheet works, but it's "pretty dumb" — no visual comparisons, no charts, and no automatic delta indicators against last month or the start of the year. The manual process is error-prone and yields a number that disappears the moment a new month starts.

This product solves that by bringing every account into one view with a beautiful UI, automatic currency conversion using real-world rates, and live delta indicators that show how net worth is changing over time — without connecting a single bank account.

## User & Persona

### Primary persona

**Anyone who manually tracks personal finances in a spreadsheet** and wants a cleaner, more visual way to do it without connecting bank accounts or using complex financial tools.

- **Role:** Individual managing personal wealth across multiple currencies and asset types (cash, investments, crypto).
- **Context:** They already track their finances manually. They have accounts in multiple currencies (PLN, USD, EUR) and assets in multiple forms (investment funds, bonds, BTC, ETH, USDT, gold).
- **Moment they reach for the product:** End of month — monthly review time — when they want to see how their net worth changed but assembling the picture requires copying numbers from multiple places, converting currencies, and calculating totals manually in a spreadsheet.

### Secondary persona

Out of scope for MVP: shared/family accounts, team workspaces, or admin views.

## Success Criteria

### Primary

- User can add, edit, and delete accounts across cash (PLN, USD, EUR) and investment (funds, bonds, crypto) categories and see their total net worth converted to a user-selected display currency within a single screen load.
- Net worth snapshots are automatically saved on every account change, enabling delta comparison vs. prior month and vs. first snapshot.

### Secondary

- A beautiful, clear UI that makes the financial picture instantly readable — better than any spreadsheet.
- User can view a line chart of net worth history across saved snapshots.

### Guardrails

- **Privacy:** User data is never shared or exposed outside the authenticated user's account.
- **Rate caching:** Exchange rates are fetched at most once per 24-hour period to avoid API abuse; cached rates are used when APIs are unavailable.

## User Stories

### US-01: User views their net worth with deltas

- **Given** I am logged in and have saved account balances
- **When** I open the dashboard
- **Then** I see my total net worth converted to my display currency, with colored delta indicators (percentage + absolute change) vs. last month and vs. first snapshot

#### Acceptance Criteria

- Net worth total is visible immediately on dashboard load
- Delta indicators show both percentage and absolute change
- Deltas are colored (green for gain, red for loss) with text/icon fallback for accessibility
- Deltas compare to last snapshot with a date and to the earliest snapshot, not a fixed calendar date

### US-02: User manages accounts

- **Given** I am logged in
- **When** I add a cash or investment account with its name, amount, and type
- **Then** the account appears in my account list and my net worth updates immediately
- **And** a snapshot is automatically saved

#### Acceptance Criteria

- Cash accounts accept: name, amount, currency (PLN, USD, EUR)
- Investment accounts accept: name, amount, asset type (funds, bonds, BTC, ETH, USDT, gold)
- Edit and delete actions are available on each account
- Deleting an account triggers an automatic snapshot save
- Editing an account triggers an automatic snapshot save

### US-03: User views net worth history

- **Given** I have two or more snapshots saved
- **When** I open the chart view
- **Then** I see a line chart of my net worth over time across all saved snapshots

#### Acceptance Criteria

- Chart renders a line for net worth over time
- Chart axis labels show dates and values in display currency

## Functional Requirements

### Authentication

- FR-001: User can register an account with email and password. Priority: must-have
  > Socrates: Counter-argument: "email+password adds signup friction." Resolution: kept; auth needed for data persistence across devices.

- FR-002: User can log in with their registered email and password. Priority: must-have

### Account Management

- FR-003: User can add a cash account with a name, amount, and currency (PLN, USD, EUR). Priority: must-have
  > Socrates: Counter-argument considered: "cash vs investment split adds complexity." Resolution: kept; both are distinct asset types the user needs.

- FR-004: User can add an investment account with a name, amount, and asset type (funds, bonds, BTC, ETH, USDT, gold). Priority: must-have
  > Socrates: Counter-argument: "investment accounts are premature for v1." Resolution: kept; user already has these in their current tracking.

- FR-005: User can edit an existing account (name, amount, type). Priority: must-have
  > Socrates: Counter-argument: "delete is too destructive." Resolution: kept; users need to correct errors.

- FR-006: User can delete an account. Priority: must-have

### Net Worth Display

- FR-007: User can set a display currency for net worth conversion. Priority: must-have
  > Socrates: Counter-argument: "display currency should default, not require a setting." Resolution: kept; user preference, may change over time.

- FR-008: User can view their total net worth converted to the display currency using exchange rates that are automatically fetched once per day from free APIs (PLN, USD, EUR, BTC, ETH, USDT, gold). Priority: must-have
  > Socrates: Counter-argument: "live rates create API dependency." Resolution: updated to daily-cached approach — rates fetched once per day, stored, reused. API source: frankfurter.app (fiat), CoinGecko (crypto, gold).

- FR-009: User can view net worth change vs. last snapshot and vs. first snapshot. Colored delta indicators showing both percentage and absolute change. Priority: must-have
  > Socrates: Counter-argument: "what if user joined mid-year?" Resolution: updated to compare to first snapshot (not start of year), plus added percentage + absolute + color coding per user direction.

- FR-010: User can view a line chart of net worth across saved snapshots. Priority: must-have
  > Socrates: Counter-argument: "chart adds charting library dependency." Resolution: kept; line chart is core to the value proposition.

### Snapshots

- FR-011: A snapshot is automatically created when the user adds, edits, or deletes an account. Months with no activity have no snapshot. Priority: must-have
  > Socrates: Counter-argument: "auto-save removes user agency." Resolution: kept; auto-save ensures history is captured without relying on user remembering.

## Non-Functional Requirements

- **Rate caching:** Exchange rates are fetched at most once per 24-hour period to avoid API rate limits. Cached rates are used for all conversions until the next refresh.
- **Offline resilience:** If exchange rate API is unavailable, the most recently cached rates are used with a clear indicator that rates may be stale.
- **Data privacy:** All user data is private to the authenticated user; no data leaves the user's account except as needed for rate fetching.
- **Accessibility:** Core net worth number and delta indicators must be readable without relying on color alone (e.g., icon or text label alongside color).
- **Browser support:** The product remains usable on the latest two major versions of mainstream desktop browsers.

## Business Logic

The app calculates the user's total wealth in a single currency by applying real-world exchange rates to every account the user enters. Every account balance — cash in any supported currency, or investment assets (funds, bonds, crypto, gold) — is converted to the user's chosen display currency using daily-cached rates fetched from free APIs. The converted amounts are summed into a single net worth figure. A snapshot captures the total and per-account balances at the moment of any account change, building a history that enables delta comparison over time.

**Secondary domain concern:** FIRE (Financial Independence, Retire Early) progress tracking — a feature that tracks the user's progress toward financial independence based on their net worth trajectory. *(See Open Questions.)*

## Access Control

- User authenticates via email + password (flat user model — one account per person, no roles).
- All data is private to the logged-in user; no data sharing between accounts.

## Non-Goals

- **Avoid:** Connecting to banks, brokers, or financial institutions — all input is manual.
- **Avoid:** Multi-user accounts, family sharing, or team workspaces — single-tenant only.
- **Avoid:** Budgeting, expense tracking, or goal setting — this is a read-only net worth tracker. *(Note: FIRE progress tracking is a potential future direction; see Open Questions.)*
- **Avoid:** Notifications or reminders to update balances.
- **Avoid:** Currency display switcher — one display currency per user, set once and changeable.
- **Avoid:** PDF or CSV export.
- **Avoid:** Inflation-adjusted calculations.
- **Avoid:** Mobile app — web only for MVP.

## Open Questions

1. **Display currency default** — What should the default display currency be? USD? EUR? Based on user locale? — Owner: user
2. **Rate fetch timing** — Should rates refresh at a fixed time each day, or on first app open after 24 hours? — Owner: user
3. **FIRE progress tracker** — The user mentioned FIRE (Financial Independence, Retire Early) progress tracking as a secondary domain concern. This conflicts with the current non-goal of "no goal setting." Should this feature be added to the roadmap, or is it out of scope permanently? — Owner: user