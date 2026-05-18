---
name: net-worth-tracker
description: Personal net worth tracker with multi-currency support, auto-snapshots, and delta indicators
context_type: greenfield
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 4.5, 5, 6, 7]
  frs_drafted: 9
  quality_check_status: accepted
updated: 2026-05-18
---

# Shape Notes — Net Worth Tracker

## Vision & Problem Statement

**Pain:** Anyone manually tracking their personal finances in a spreadsheet can't see their real financial picture without spending significant time aggregating scattered data across currencies and asset types.

**Who has it:** Anyone who tracks personal finances manually — cash in different currencies, investment funds, bonds, crypto.

**Moment:** Monthly review time — end of month, when they want to see how their net worth changed, but assembling the picture requires copying numbers from multiple places, converting currencies, and calculating totals manually in a spreadsheet.

**Cost today:** A manual, error-prone process that yields a number they have to re-build every time. The spreadsheet works but is "pretty dumb" — no visual comparisons, no charts, no automatic deltas against last month or start of year.

**Insight:** A spreadsheet does the math but provides no visual clarity, no charts, and no automatic comparison to prior periods. The product brings everything into one view with a beautiful UI and automatic tracking.

## User & Persona

- **Primary persona:** Broad — anyone who manually tracks personal finances in a spreadsheet and wants a cleaner, more visual way to do it without connecting bank accounts.
- **Secondary (out of scope):** Shared/family accounts, team workspaces, admin views.

## Access Control

- User authenticates via email + password (flat user model — one account per person, no roles).
- All data is private to the logged-in user.

## Success Criteria

### Primary
MVP flow: User opens app → logs in → adds cash account (name, amount, currency) → adds investment account → sees total net worth in display currency with delta indicators → app auto-saves snapshot on each change → user views net worth chart.

### Secondary
A beautiful, clear UI that makes the financial picture instantly readable — better than any spreadsheet.

### Guardrails
- Privacy: user data never shared or exposed.
- Rate caching: exchange rates fetched once per day max to avoid API abuse.

## Functional Requirements

- FR-001: User can register an account and log in with email + password. Priority: must-have
  > Socrates: Counter-argument: "email+password adds signup friction." Resolution: kept; auth needed for data persistence across devices.
- FR-002: User can add a cash account with a name, amount, and currency (PLN, USD, EUR, PLN). Priority: must-have
  > Socrates: Counter-argument considered: "cash vs investment split adds complexity." Resolution: kept; both are distinct asset types the user needs.
- FR-003: User can add an investment account with a name, amount, and asset type (funds, bonds, crypto — BTC, ETH, USDT, gold). Priority: must-have
  > Socrates: Counter-argument: "investment accounts are premature for v1." Resolution: kept; user already has these in their current tracking.
- FR-004: User can edit and delete accounts. Priority: must-have
  > Socrates: Counter-argument: "delete is too destructive." Resolution: kept; users need to correct errors.
- FR-005: User can set a display currency for net worth conversion. Priority: must-have
  > Socrates: Counter-argument: "display currency should default, not require a setting." Resolution: kept; user preference, may change over time.
- FR-006: User can view their total net worth converted to the display currency using exchange rates that are automatically fetched once per day from free APIs (USD, EUR, PLN, BTC, ETH, USDT, gold). Priority: must-have
  > Socrates: Counter-argument: "live rates create API dependency." Resolution: updated to daily-cached approach — rates fetched once per day, stored, reused. API source: frankfurter.app (fiat), CoinGecko (crypto, gold).
- FR-007: User can save a snapshot of their accounts. A snapshot is automatically created when the user adds, edits, or deletes an account. Months with no activity have no snapshot. Priority: must-have
  > Socrates: Counter-argument: "auto-save removes user agency." Resolution: updated to trigger on account changes; kept auto-save as it ensures history is captured without relying on user remembering.
- FR-008: User can view net worth change vs. last month and vs. first snapshot. Colored delta indicators showing both percentage and absolute change. Priority: must-have
  > Socrates: Counter-argument: "what if user joined mid-year?" Resolution: updated to compare to first snapshot (not start of year), plus added percentage + absolute + color coding per user direction.
- FR-009: User can view a line chart of net worth across saved snapshots. Priority: must-have
  > Socrates: Counter-argument: "chart adds charting library dependency." Resolution: kept; line chart is core to the value proposition.

## User Stories

- US-01: **Given** I am logged in, **When** I have saved account balances, **Then** I see my total net worth converted to my display currency, with colored delta indicators (percentage + absolute) vs. last month and vs. first snapshot.

## Business Logic

The application computes a single net worth value by converting every account balance to a user-selected display currency using daily-cached exchange rates (fiat: frankfurter.app; crypto/gold: CoinGecko), then summing them. Snapshots capture the converted total and the per-account balances at the moment of change, enabling delta comparison over time. The domain rule is: **the app calculates the user's total wealth in a single currency by applying real-world exchange rates to every account the user enters.**

**Secondary domain concern:** FIRE (Financial Independence, Retire Early) progress tracking — a feature that tracks the user's progress toward financial independence based on their net worth trajectory.

---

## Product Framing

- **product_type:** web-app
- **target_scale:** medium (dozens to a hundred users)
- **timeline_budget:**
  - mvp_weeks: ~3
  - hard_deadline: null
  - after_hours_only: true

---

## Quality Cross-Check

All six quality elements present:

- Access Control: present
- Business Logic: present (one-sentence rule captured)
- Project artifacts: present
- Timeline-cost ack: present (flow fits ~3 weeks after-hours)
- Non-Goals: present (8 items)
- Preserved behavior: n/a (greenfield)

## Non-Functional Requirements

- **Rate caching:** Exchange rates are fetched at most once per 24-hour period to avoid API rate limits. Cached rates are used for all conversions until the next refresh.
- **Offline resilience:** If exchange rate API is unavailable, use the most recently cached rates with a clear indicator that rates may be stale.
- **Data privacy:** All user data is private to the authenticated user; no data leaves the user's account except as needed for rate fetching.
- **Accessibility:** Core net worth number and delta indicators must be readable without color reliance (e.g., icon or text label alongside color).

## Non-Goals

- **Avoid:** Connecting to banks, brokers, or financial institutions — all input is manual.
- **Avoid:** Multi-user accounts, family sharing, or team workspaces — single-tenant only.
- **Avoid:** Budgeting, expense tracking, or goal setting — this is a read-only tracker.
- **Avoid:** Notifications or reminders to update balances.
- **Avoid:** Currency display switcher — one display currency per user, set once.
- **Avoid:** PDF or CSV export.
- **Avoid:** Inflation-adjusted calculations.
- **Avoid:** Mobile app (web only for MVP).

## Open Questions

- TBD: display currency default (what should the default be — USD? EUR? something based on user locale?)
- TBD: rate fetch timing — should rates refresh at a fixed time each day, or on first app open after 24h?

## Forward: tech-stack

> User has not specified a tech stack. These preferences emerged during the conversation and are captured here for downstream stack selection:

- User values a "beautiful UI" over a plain one — visual design matters.
- User prefers a web app.
- No preference stated on framework, language, or deployment.
- Rates sourced from: frankfurter.app (fiat), CoinGecko (crypto/gold).