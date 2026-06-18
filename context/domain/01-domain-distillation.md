---
title: BitWorth — Domain Distillation
created: 2026-06-18
type: domain-distillation
---

# BitWorth — Domain Distillation

> A map of the business domain distilled from source documents and code. The deliverable is a **map**, not code.
> Method: discovery → analysis → classification. All concepts and requirement numbers were **discovered**, not assumed.

---

## STEP 0 — Project context

**What the product is.** BitWorth is a privacy-first net worth tracker for a single user ("Alex"), replacing a
monthly Excel spreadsheet. The user manually enters account balances across multiple currencies and categories,
and the app consolidates them into **one number** in a display currency, compared against the previous month and
against January 1st, with a trend chart. (`net-worth-tracker-mvp.md:5-8`, `context/foundation/prd.md:18-22`)

**Source documents (found and read):**
- `context/foundation/prd.md` — the canonical PRD (vision, success criteria, US-01..03, FR-001..020, non-goals, open questions).
- `net-worth-tracker-mvp.md` — earlier MVP spec (category tables, "NOT in MVP" list, FIRE description).
- `context/foundation/roadmap.md` — 10 vertical slices (F-01, S-01..S-10), all marked `done`.
- `context/foundation/tech-stack.md` — stack rationale.
- `README.md`, `CLAUDE.md` — engineering rules and description.

**Note on source material:** The PRD and `net-worth-tracker-mvp.md` **disagree** in two places (currency switcher, FIRE)
— see STEP 4. Where they conflict, I treat the PRD as canon and the MVP spec as historical.

**Stack and structure (where business logic lives):**
- Framework: Astro v6 SSR + React 19 islands; TypeScript strict; Supabase (Postgres + Auth + RLS); Cloudflare Workers.
- **Domain logic (pure):** `src/lib/` — `net-worth.ts` (conversion + sum), `fire.ts` (FIRE projection),
  `exchange-rates.ts` (rates), `crypto-prices.ts` (crypto prices).
- **API layer (orchestration + persistence):** `src/pages/api/` — `assets/`, `snapshots/`, `categories/`,
  `user-preferences/`, `rates.ts`, `crypto-price.ts`, `auth/`.
- **Persistence / schema:** `supabase/migrations/*.sql`, category seed in `supabase/seed.sql`.
- **UI (React islands):** `src/components/` (assets, fire, settings) and pages under `src/pages/dashboard/`.
- **Access gate:** `src/middleware.ts` (`PROTECTED_ROUTES = ["/dashboard"]`, sets `locals.displayCurrency`).

---

## STEP 1 — Ubiquitous Language

For each concept: definition → source citation → location in code (or "ABSENT in code").

| Concept | Definition | Source citation | Lives in code |
|---|---|---|---|
| **Net Worth** | Sum of assets minus sum of liabilities, in the display currency. The product's single, central number. | "Net Worth = Total Assets − Total Liabilities" `net-worth-tracker-mvp.md:53`; FR-014 `prd.md:108` | `src/lib/net-worth.ts:40-56` (`computeNetWorth`) |
| **Asset** | A single entry: name, amount, currency, category; optionally `crypto_symbol`, `quantity`, `notes`. | FR-006 `prd.md:98` | `assets` table `migrations/20260529190856_initial_schema.sql:28-39`; `quantity` `migrations/20260531223101_crypto_price_cache.sql:43`; CRUD `src/pages/api/assets/index.ts` |
| **Liability** | An asset in a category flagged `is_liability`, subtracted from net worth. | FR-010 `prd.md:102`; "tracked as negative" `net-worth-tracker-mvp.md:49` | `asset_categories.is_liability` flag `initial_schema.sql:22`; logic `net-worth.ts:49-53` |
| **Asset Category** | One of 13 fixed categories (seeded, immutable), with `display_order` and `is_liability`. | FR-009 (13 categories) `prd.md:101`; tables `net-worth-tracker-mvp.md:19-51` | `seed.sql:6-19` (13 rows); table `initial_schema.sql:18-25` |
| **Display Currency** | The currency (PLN/USD/EUR) all totals are shown in; a user preference. | FR-011 `prd.md:105` | `user_preferences.display_currency` `initial_schema.sql:11`; PUT `api/user-preferences/index.ts:157-162`; `middleware.ts:31` |
| **Exchange Rate** | A currency conversion rate, fetched live (frankfurter.app) with a cache and a static fallback. | FR-012/013 `prd.md:106-107` | `src/lib/exchange-rates.ts:46-86`; cache `exchange_rate_cache` `initial_schema.sql:69-75` |
| **Snapshot** | A point-in-time saved state: `total_net_worth`, `display_currency`, `base_currency`, `source` (manual/auto). | FR-016/017 `prd.md:112-113` | `snapshots` table `initial_schema.sql:42-51`; creation `api/snapshots/index.ts:109-121` |
| **Snapshot Item** | An itemized asset value at snapshot time: original amount + converted amount + rate used. | (implied by "stored with converted amounts" non-goal #7 `prd.md:146`) | `snapshot_items` table `initial_schema.sql:54-66`; insert `api/snapshots/index.ts:140-153` |
| **Delta Indicator** | Net worth change vs last month and vs January 1st — absolute and percentage. | FR-015 `prd.md:109`; "Delta indicators" `net-worth-tracker-mvp.md:66` | `src/components/assets/NetWorthDisplay.tsx:152-181` |
| **Historical Chart** | A line chart of net worth across all snapshots over time. | FR-018 `prd.md:114` | `src/components/NetWorthChart.tsx` |
| **Crypto Price** | Market price of BTC/ETH/altcoins fetched live (CoinGecko), with cache and fallback. | FR-019/020 `prd.md:117-118` | `src/lib/crypto-prices.ts:123-160`; cache `migrations/20260531223101_crypto_price_cache.sql` |
| **Snapshot auto-save (once/month)** | The app automatically saves a snapshot once per calendar month. | FR-016 `prd.md:112` | **ABSENT in code** — POST only inserts `source: "manual"` (`api/snapshots/index.ts:118`); no `source: "auto"` path exists |
| **Demo Mode** | Exploring the app with sample data without logging in. | FR-002 `prd.md:91`; US-02 `prd.md:64-73` | **ABSENT in code** — no demo implementation (landing `Welcome.astro` has no demo path) |
| **FIRE Number / Projection** | Portfolio size needed for financial independence + projection of years-to-FI; Coast/Barista variants. | "FIRE Number = Annual Expenses / SWR" `net-worth-tracker-mvp.md:105`; S-09 `roadmap.md:39` | `src/lib/fire.ts:67-138`; page `pages/dashboard/fire.astro` |
| **User Preferences** | 1:1 with the user: currency, theme, FIRE parameters; auto-created by trigger. | FR-011 `prd.md:105`; S-05 `roadmap.md:35` | table + trigger `initial_schema.sql:9-15,120-131`; FIRE cols `migrations/20260611120000_user_preferences_fire.sql` |
| **Account Isolation** | One user's financial data is never accessible to another. | Guardrail `prd.md:47`; NFR `prd.md:124` | RLS policies `initial_schema.sql:91-104`; `middleware.ts:35` |

---

## STEP 2 — Subdomain classification: Core / Supporting / Generic

Core = what makes the product distinct and meaningful (validation milestone: S-02, `roadmap.md:24`).

| Area / concept | Category | Rationale (tied to product goals) |
|---|---|---|
| **Net Worth Computation** (multi-currency consolidation, assets − liabilities → 1 number) | **CORE** | This is the product's core insight: "consolidating disparate numbers into one view, with automatic currency conversion" `prd.md:22`. Without it the product doesn't exist. |
| **Snapshot History & Deltas** (snapshots + comparison to last month/Jan 1st + trend) | **CORE** | The north star / validation milestone: "see net worth, deltas, and trend chart from snapshots" `roadmap.md:24,32`. This proves the "better than a spreadsheet" hypothesis. |
| **Asset Management** (CRUD of entries by category and currency) | **Supporting** | Essential input to the core, but not a differentiator in itself — it's "manual input", deliberately simple (non-goal: no bank integrations `prd.md:141`). |
| **Display Currency Preference** | **Supporting** | Supports the core (choice of summation currency), but is a preference, not the essence. FR-011 `prd.md:105`. |
| **FIRE Calculator** (projection, FIRE number, Coast/Barista) | **Supporting** *(differentiator, but out of MVP scope)* | Value-add ("Nice to Have" `net-worth-tracker-mvp.md:83`), **explicitly a non-goal for v1**: "No FIRE calculator in v1" `prd.md:140`. Shipped in S-09 anyway — see STEP 4. |
| **Authentication** (email+password, sessions) | **Generic** | Standard capability delivered by Supabase SSR; "flat user model, no roles" `prd.md:136`. No competitive edge. |
| **Exchange Rate fetching** (frankfurter + cache) | **Generic** | Commodity: any free rates API works (open question #2 `prd.md:151`). Requirement: fail gracefully. |
| **Crypto Price fetching** (CoinGecko + cache) | **Generic** | Commodity: any free price API works (open question #3 `prd.md:152`). |
| **Theme / PWA / responsiveness** | **Generic** | UX conveniences (S-06..S-08), not domain-differentiating. |

---

## STEP 3 — Aggregate candidates and their invariants

Enforcement status: **enforces** (DB/types force it) / **declares** (code computes at runtime, no hard barrier) / **ignores**.

### Aggregate A — `Snapshot` (root: `snapshots`, child: `snapshot_items`)
- **N1:** A snapshot's `total_net_worth` MUST equal the sum of its converted items (assets − liabilities) at save time.
  - Source: FR-014 `prd.md:108`; non-goal #7 "snapshot values are stored with converted amounts" `prd.md:146`.
  - Status: **declares, inconsistently** — total computed separately in a loop `api/snapshots/index.ts:97-107`; items inserted separately (`:140-153`). No validation of `total == Σ items`. `snapshot_items.converted_amount` does **not** store `is_liability`, so the items alone can't reconstruct the sign of liabilities → the total is unverifiable from its children.
- **N2:** A snapshot and its items are written atomically (either both or neither).
  - Status: **declares** — no DB transaction; a manual compensation: `delete` the snapshot if the items insert fails `api/snapshots/index.ts:155-156`. Works for an items error, but not for a process crash in between.
- **N3:** Deltas compare snapshots **in the same display currency**.
  - Source: FR-015 (net worth change) + FR-011 (everything in display currency) `prd.md:105,109`.
  - Status: **ignores** — delta computed as a difference of `total_net_worth` without checking `display_currency` `NetWorthDisplay.tsx:165-166`. After a currency change between snapshots, deltas mix currencies (see STEP 4, D-1).

### Aggregate B — `Asset` (root: `assets`)
- **N1:** `currency ∈ {PLN, USD, EUR}`. Source: FR-006 `prd.md:98`. Status: **enforces** — CHECK `initial_schema.sql:34`.
- **N2:** Every asset belongs to an existing category. Status: **enforces** — FK `category_id → asset_categories(id)` `initial_schema.sql:31`.
- **N3:** A liability counts as a negative value in net worth. Source: FR-010 `prd.md:102`. Status: **declares** — the sign is not stored; it's derived at read time from `category.is_liability` (`net-worth.ts:49-53`). Consistency depends on a correct category seed.
- **N4:** `amount` is a number. Status: **enforces partially** — NUMERIC type in DB + `parseFloat`/`isNaN` in the API `api/assets/index.ts:105-114`; no sign/range validation (e.g. negative amounts allowed).

### Aggregate C — `UserPreferences` (root: `user_preferences`, 1:1 with auth.users)
- **N1:** `display_currency ∈ {PLN, USD, EUR}`. Status: **enforces** — CHECK `initial_schema.sql:12` + API `:157-162`.
- **N2:** `fire_safe_withdrawal_rate > 0` (otherwise division by zero in FIRE). Source: `fire.ts:81-83`. Status: **enforces** — DB CHECK `migrations/20260611120000_user_preferences_fire.sql:23-24` + API exclusiveMin + guard in `fire.ts`.
- **N3:** `fire_traditional_retirement_age > fire_current_age` (Coast FIRE precondition). Source: `fire.ts:23,113`. Status: **declares, leaky** — checked in the API **only when both fields are in one payload** `api/user-preferences/index.ts:93-99`; the DB CHECK bounds only each field separately (`migrations/...fire.sql:13-14,27-28`), not the relation. Updating one age can break the invariant.
- **N4:** Preferences exist for every user. Status: **enforces** — trigger `on_auth_user_created` `initial_schema.sql:120-131`.

### (Cross-cutting concept) — `NetWorth` as a Domain Service / Value
- **N:** `NetWorth = Σ(convert(asset) for assets) − Σ(convert(asset) for liabilities)` in one currency.
  - Status: **declares, duplicated in 3 places** — `net-worth.ts:40-56`, inline in `api/snapshots/index.ts:97-107`, and an IIFE in `NetWorthDisplay.tsx:137-149`. The TODO in `net-worth.ts:29-38` notes this itself. No single source of truth → drift risk.

---

## STEP 4 — MODEL vs CODE divergences

The most valuable part: where domain knowledge exists but the code doesn't reflect it (or vice versa).

| # | The document says X | The code does Y | Evidence (file:line) |
|---|---|---|---|
| **D-1** | FR-015: deltas are the **net worth** change vs month/January; FR-011: everything in the display currency. | Delta = difference of snapshot `total_net_worth` **without** checking `display_currency`. A currency change between snapshots → deltas mix PLN/USD/EUR (comparing apples to oranges). | `NetWorthDisplay.tsx:165-166` vs `snapshots.display_currency` `initial_schema.sql:46` |
| **D-2** | FR-016: the app **auto-saves a snapshot once/month**. Open question #4 left for implementation `prd.md:153`; roadmap: "schema accommodates both" `roadmap.md:82`. | No auto-save path at all. POST always inserts `source: "manual"`. The `source` column accepts `auto`, but nothing creates it. (Historical commit: "close out demo-mode/auto-save scope".) | `api/snapshots/index.ts:118`; CHECK `initial_schema.sql:48` |
| **D-3** | FR-002 + US-02: a **demo mode** with sample data without login (nice-to-have). | No demo mode implementation; the landing (`Welcome.astro`) has no "explore demo" path. Remains an unrealized nice-to-have. | absent; `prd.md:91,64-73` |
| **D-4** | PRD **Non-Goal**: "No FIRE calculator in v1" `prd.md:140`. MVP spec: FIRE = simple (FIRE number, bar, years) `net-worth-tracker-mvp.md:102-118`. | The code has an **elaborate** FIRE: Coast FIRE, Barista FIRE, the Fisher real/nominal relation, an annual projection, persistence of 9 fields. Slice S-09 marked `done`. The scope outgrew both the non-goal and the MVP spec. | `src/lib/fire.ts:67-138`; `roadmap.md:39` |
| **D-5** | MVP spec Non-Goal: "No inflation-adjusted calculations" `prd.md:145`; "Raw net worth only". | FIRE computes **entirely** in real terms (inflation via the Fisher relation) — the whole projection is inflation-adjusted. (Applies to FIRE, not net worth itself, but directly contradicts the "no inflation" principle.) | `fire.ts:8-12,51-53,85` |
| **D-6** | MVP spec "NOT in MVP": "Currency display switcher (fixed to one display currency)" `net-worth-tracker-mvp.md:76`. The PRD (newer) **reverses this**: FR-011 the user *can* set the currency. | The code implements the currency switcher (settings, preference PUT). The code follows the PRD; the two source docs conflict — the MVP spec is outdated. | `api/user-preferences/index.ts:157-162`; `middleware.ts:31` |
| **D-7** | FR-014/non-goal #7: a snapshot stores converted item values so the rate is "captured implicitly" `prd.md:146`. | `snapshot_items` stores `converted_amount` and `exchange_rate_usd`, but **not** `is_liability` — you can't reconstruct `total_net_worth` from the items alone (the sign of liabilities is lost). Total and items are computed independently, with no consistency check. | `initial_schema.sql:54-66`; `api/snapshots/index.ts:97-153` |
| **D-8** | "Net worth" domain logic as a single business rule `prd.md:128-132`. | The rule is implemented **three times** (lib, snapshots API, UI component) — drift risk; its own TODO admits this. | `net-worth.ts:40-56`; `api/snapshots/index.ts:97-107`; `NetWorthDisplay.tsx:137-149` |
| **D-9** | FR-011: "All totals are shown in this currency" (PLN/USD/EUR). | `DeltaIndicator` hardcodes a **`$`** sign regardless of the display currency; the main number uses the currency code correctly, but deltas always show `$`. | `NetWorthDisplay.tsx:29` vs `:197-198` |

---

## STEP 5 — Refactor ranking

Ranked by **value** (how core the invariant is) × **risk** (how weakly it's enforced today).

| Rank | Candidate / invariant | Value | Risk (state today) | Score |
|---|---|---|---|---|
| **#1** | **`Snapshot` aggregate** — total↔items consistency (N1, D-7) + delta comparability within one currency (N3, D-1) | **Highest** — the S-02 validation milestone, the product's core | **High** — deltas mix currencies (D-1), total unverifiable from children (D-7), no transaction (N2) | **Critical** |
| **#2** | **`NetWorth` as a single source of truth** (D-8) | High — core rule | Medium-high — 3 copies, explicit drift possible, but today they return the same thing | High |
| **#3** | **Snapshot auto-save** (D-2, FR-016 must-have) | High — must-have in the PRD, unrealized | Medium — missing feature (not a broken one); history preserved only manually | Medium |
| **#4** | **`UserPreferences` N3** — FIRE age relation (validation gap) | Medium — FIRE is Supporting/non-goal | Medium — easy to break with a partial payload | Medium |
| **#5** | **`DeltaIndicator` `$` symbol** (D-9) | Low — cosmetic, but misleading for PLN/EUR | Low — purely presentational | Low |

### #1 to refactor — the `Snapshot` aggregate

**Why.** `Snapshot` is the heart of the core subdomain (Snapshot History & Deltas, the north star `roadmap.md:24`),
and at the same time it concentrates the **most** weakly enforced invariants:
- **D-1 (N3):** deltas can compare amounts in different currencies — this directly undermines the product's promise ("how that number is changing over time"). A real bug when `display_currency` changes.
- **D-7 (N1):** `total_net_worth` is neither derivable nor verifiable from `snapshot_items` (no `is_liability` in items) — the aggregate doesn't protect its own state.
- **N2:** the write isn't transactional (only a manual compensation).

**Direction (map, not code):** make `Snapshot` a true aggregate with an explicit boundary — (a) store the currency and make it part of the delta contract (compare only homogeneous currencies, or convert snapshots to the current currency via the captured rate), (b) store the sign / `is_liability` in items so `total == Σ items` is verifiable and enforced, (c) one transactional write through the root. Refactor #2 (a single `computeNetWorth`) is a natural prerequisite — the same service should feed both the dashboard and snapshot creation.

---

## Summary

This artifact distills the BitWorth domain — a privacy-first net worth tracker (Astro + Supabase) — from the PRD,
the earlier MVP spec, the roadmap, and the code itself. It defines a Ubiquitous Language (15 concepts with source↔code
citations), classifies the subdomains (core: **net worth consolidation** and **snapshots + deltas**; supporting: assets,
currency, FIRE; generic: auth, rates, crypto prices), and identifies aggregate candidates with their invariants and
enforcement status. The key takeaway: the core `Snapshot` aggregate is both the most valuable and the least protected —
deltas compare amounts without checking the display currency (D-1), and `total_net_worth` is not verifiable from its
items because they don't store the sign of liabilities (D-7). The rule "net worth = assets − liabilities" lives in three
copies (D-8), inviting drift. Two implementation gaps against must-have/nice-to-have requirements were found (the
once/month auto-save FR-016 and demo mode FR-002 — both **absent in code**), plus one scope that outgrew the documents
(an elaborate FIRE despite the v1 non-goal, D-4/D-5). Recommendation #1: unify the net worth computation into one
service and turn `Snapshot` into an aggregate with an explicit currency boundary and verifiable total↔items consistency.
