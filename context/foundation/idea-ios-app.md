---
project: "BitWorth"
context_type: idea
status: idea — researched, not scheduled
created: 2026-07-27
updated: 2026-07-27
---

# Idea: BitWorth iOS App (Expo / React Native)

Ship a **public App Store iOS app with a free/Pro paywall**, built with Expo / React Native in a **separate repo** (`bitworth-mobile`), reusing the Supabase backend. The web app stays as-is. This document records the researched strategy (codebase audit + 2025–2026 App Store landscape research, 2026-07-27) so it can mature into a roadmap slice later.

## Why Expo (options researched and rejected)

- **PWA**: already shipped, but PWAs cannot be listed in the App Store → fails the goal.
- **Capacitor**: Astro `output: 'server'` can't run in a webview → unofficial dual static/SSR build + client-rendering all SSR pages + the *same* auth/data rework as RN, plus 3–5 real native features to survive guideline 4.2, with recurring re-rejection risk on every update (Apple's current rejection template: push/location/sharing bolt-ons are "not robust enough"; reviewers test airplane mode).
- **Tauri v2 / PWABuilder / Swift**: thin mobile ecosystem + same webview 4.2 exposure / community-maintained with documented 4.2 rejections / full rewrite over solo-dev budget (but see OQ1).
- **Expo wins**: native UI by construction (zero 4.2 risk), first-party Supabase support, EAS cloud builds handle signing (free tier: 15 iOS builds/mo, commercial use OK), RevenueCat RN SDK for IAP. The crown jewels port 1:1: the RLS-scoped Supabase schema (23 migrations) and ~2,790 LOC of framework-free domain math in `src/lib`.

## App Store rules (researched, current 2026)

- **IAP is mandatory** for in-app digital unlocks (guideline 3.1.1). Use StoreKit 2 via RevenueCat (`react-native-purchases`; free < $2.5k/mo tracked revenue). Post-Epic US external-link checkout is currently commission-free but litigation-dependent (SCOTUS, Oct 2026 term) — optional later, not foundational.
- **Account deletion in-app is a hard requirement** (5.1.1(v)) — BitWorth has no such feature today; it's net-new backend work.

## Verified codebase facts that shaped the design

- All dashboard reads happen inline in `.astro` frontmatter (no GET aggregate endpoints exist); the math lives in portable `src/lib` modules that take a `SupabaseClient` argument.
- Auth is email/password only, cookie-based `@supabase/ssr` — no OAuth → no deep-link complexity on mobile.
- `src/lib/crypto-prices.ts` / `metal-prices.ts` import `COINGECKO_API_KEY` / `METALS_API_KEY` from `astro:env/server` → **NOT portable** (keys must never ship in an app binary). `exchange-rates.ts` is keyless (frankfurter.app) → portable. `/api/rates` is intentionally public.
- Price cache tables have public SELECT-only RLS (client upserts silently no-op — already the web behavior; harmless).
- `restore_backup` is a SECURITY DEFINER RPC callable via plain user-scoped `supabase.rpc()`.
- iOS launcher icons already generated: `public/icons/app_icons/ios/`.

## Architecture decisions

**D1 — Data access: hybrid.** Direct `supabase-js` (RLS-enforced) for all user-scoped reads/writes and the `restore_backup` RPC; port `exchange-rates.ts` for FX. The only deployed-API dependency: `/api/crypto-price` and `/api/metal-price` (server-held keys). One small **additive** web-side change enables that: extend `createClient` in `src/lib/supabase.ts` to also honor `Authorization: Bearer <access_token>` when no cookie is present — the routes themselves are unchanged (they just call `supabase.auth.getUser()`), and `src/pages/api/api-auth-contract.test.ts` guards the contract.

**D2 — Repo structure: separate `bitworth-mobile` repo + one-way sync script.** `scripts/sync-domain.sh` rsyncs the portable domain set from a sibling web checkout into `src/domain/` and runs the test suite (tests are the drift detector; web stays source of truth). Portable set: `net-worth, fire, monte-carlo, allocation, goals, trajectory, movers, asset-trends, contributions, backup, exchange-rates, utils` + colocated tests + regenerated `database.types.ts`. Excluded: `crypto-prices.ts`/`metal-prices.ts` (`astro:env/server`), `category-icons.tsx` (DOM). Add "re-sync + test" to the web repo's release checklist when `src/lib` math changes.

**D3 — Paywall: tracker free, insights Pro.**

- **Free**: full asset/liability CRUD (no caps), snapshots, net-worth trend chart, live prices/FX, settings, backup export+import (data portability never paywalled — privacy-first positioning + App Review goodwill).
- **Pro** (single subscription, monthly + annual): FIRE calculator + projections, Monte Carlo forecast, balancer + drift alerts, savings goals, analytics (movers, per-asset trends, contributions).

Enforced client-side at the router via RevenueCat entitlement; `is_pro` flag in Supabase (via webhook) is server-side truth for analytics/future use, not v1 enforcement.

**D4 — Navigation (Expo Router):**

```
(auth)/sign-in | sign-up | confirm-email
(tabs)/index        ← Home: net-worth summary + trend chart + top movers
(tabs)/assets       ← list; assets/new + assets/[id] as stack/modal screens
(tabs)/planning     ← hub → fire, forecast, balancer, goals (Pro-gated stack)
(tabs)/settings     ← currency, theme, backup, account deletion, manage subscription
paywall             ← modal from any locked screen
```

Root layout does the Supabase session check + redirect (documented Expo Router protected-routes pattern).

**D5 — Charts: Victory Native XL (Skia)** for all 8 Recharts ports: net-worth/asset-trends/FIRE → `CartesianChart` + `Line`/`Area`; contributions → stacked `Bar`; Monte Carlo fan → layered `Area` bands or simplified p10/p50/p90 lines (hardest port — schedule late); balancer/goals donuts → `PolarChart`/`Pie`. Chart data prep is all in synced domain code; RN components only render.

**D6 — Offline v1: read-cache only.** TanStack Query + AsyncStorage persister — last-fetched data renders offline with a banner; mutations require connectivity. No write queue in v1.

**Auth on mobile**: `supabase-js` with SecureStore storage adapter (`persistSession: true`, `detectSessionInUrl: false`); known SecureStore 2KB token limit → Supabase's documented encrypted-AsyncStorage fallback if hit.

## Phases

**Phase 0 — Accounts & pipeline** (start day one; enrollment has multi-day latency): Apple Developer Program ($99/yr); App Store Connect app shell + bundle ID; Expo account + EAS init. Simulator dev needs none of this — Phase 1 proceeds in parallel.

**Phase 1 — Scaffold & foundation**: `create-expo-app` (Expo Router, TS strict); supabase-js + SecureStore adapter; env handling; `sync-domain.sh` + first sync with domain tests green; TanStack Query; design tokens; empty tab shell.

**Phase 2 — TestFlight vertical slice**: auth screens; session-gated routing; assets list (direct supabase-js); Home screen replicating `dashboard.astro` frontmatter queries + `net-worth.ts` math; net-worth chart (first Victory Native integration — de-risks the chart library early); snapshots read. **Deliverable: TestFlight build #1 on a real iPhone** via EAS Build + Submit.

**Phase 3 — Full CRUD + settings**: asset create/edit/delete across 13 categories; crypto/metal lookups (ship the bearer-token tweak to the web repo first); snapshot creation; user preferences (display currency, theme); settings screen. *Exit: core-tracker parity with web.*

**Phase 4 — Planning & analytics screens**: movers, asset trends, contributions, FIRE, Monte Carlo forecast (run off first paint), balancer, goals. All math is synced domain code — the work is screens + charts.

**Phase 5 — Monetization**: RevenueCat project + `react-native-purchases`; subscription products (monthly/annual, intro offer) in App Store Connect; paywall modal; entitlement gating of Phase-4 screens; Supabase Edge Function receiving RevenueCat webhooks (verify webhook auth header) → `is_pro` migration; sandbox purchase + restore-purchases testing.

**Phase 6 — Compliance + polish**: **in-app account deletion** (new Edge Function with service-role `auth.admin.deleteUser`, confirmation UI in Settings) — the known hard blocker, done here, not discovered at review; backup export via `expo-file-system` + `expo-sharing`, import via `expo-document-picker` → `restore_backup` RPC; offline persister; error/empty states; app icon (reuse `public/icons/app_icons/ios/`), splash, haptics.

**Phase 7 — Submission**: privacy nutrition labels (financial info linked to identity, no tracking — honest and favorable); screenshots (6.7" + 6.9"); review notes + seeded demo account (finance apps get functional review); subscription metadata + EULA/privacy-policy URLs; EAS Submit; respond to review feedback.

## Risks

1. **Account deletion** — mandatory, net-new backend; scheduled Phase 6, not discovered at review.
2. **Apple enrollment delays** (identity checks) — Phase 0 starts immediately.
3. **Domain drift** — sync is one-way manual discipline; mitigated by synced tests + web release-checklist entry.
4. **Monte Carlo fan chart** — largest Victory Native unknown; net-worth chart in Phase 2 de-risks the library, fan simplification (3 lines) is the fallback.
5. **Bearer-token change on web** must not weaken cookie auth — additive in `createClient` only; `api-auth-contract.test.ts` guards it.
6. **RevenueCat webhook** — verify its Authorization header in the Edge Function; never trust client-only entitlement for anything the server could leak.

## Critical files

- Web-side change (only one): `src/lib/supabase.ts` — add bearer-token support to `createClient`.
- Portable domain set (sync source): `src/lib/{net-worth,fire,monte-carlo,allocation,goals,trajectory,movers,asset-trends,contributions,backup,exchange-rates,utils}.ts` + tests + `database.types.ts`.
- Read-path blueprints (queries → TanStack hooks): `src/pages/dashboard.astro`, `src/pages/dashboard/{assets/index,balancer,fire,forecast,goals,settings}.astro`.
- Mutation blueprints: supabase calls inside `src/pages/api/{assets,snapshots,goals,allocation-cards,allocation-targets,user-preferences}/`.
- Backup import pattern: `src/pages/api/backup/import.ts` (validation + `restore_backup` RPC).
- RLS baseline: `supabase/migrations/20260529190856_initial_schema.sql`; new `is_pro` migration in Phase 5.
- Icons: `public/icons/app_icons/ios/`.

## Open questions

**OQ1 — If the mobile app lives in a separate repo anyway, why not rewrite it natively in Swift/SwiftUI?**
Fair question — the repo-separation argument doesn't distinguish them. What does:

- *The sync script copies TypeScript verbatim; Swift would translate it.* The ~2,790 LOC of domain math (FIRE, Monte Carlo, allocation, trajectory…) plus its test suite would need a hand-port to Swift and then permanent dual-language maintenance — every future formula change made twice, with numeric-parity bugs (web says one FIRE date, phone says another) as the failure mode. With RN, the same `.ts` files and the same tests run on both.
- *Skillset & velocity*: the whole existing product is TypeScript/React — React knowledge transfers to RN; SwiftUI is a new language, UI paradigm, and ecosystem for a solo dev.
- *What Swift would actually buy*: best-in-class polish, widgets/watchOS/App Intents, no JS runtime. For a CRUD + charts tracker, RN's native UI is practically indistinguishable — and none of the Swift-only surfaces (widgets etc.) are on the roadmap.
- *When Swift would be right*: if a goal is learning Swift for its own sake, or if iOS-exclusive surfaces (widgets, Watch) become the product's edge. Otherwise Expo remains the recommendation. (supabase-swift is official, so backend reuse is equal either way — the differentiator is purely the domain-logic port.)

**OQ2 — One app with a paywall, or two listings (free/lite + paid)?**
Recommendation: **one app with IAP paywall**. The two-app model is the legacy pattern and loses on every axis in 2026: pay-before-try converts far worse than freemium (no trial, no intro offers), ratings/reviews and search ranking split across two listings, two builds/two submissions per release, no shared purchase state (upgrading users must buy again or juggle apps — data would follow the Supabase account, but the purchase wouldn't), and Apple's tooling (intro offers, win-back offers, family sharing, price experiments) exists for IAP subscriptions, not paid-up-front apps. A single listing with a genuinely useful free tier also *is* the App Review mitigation for finance apps. Sub-question to decide at Phase 5, not now: subscription only, or subscription + one-time "lifetime" unlock (privacy-first audiences often prefer lifetime; RevenueCat supports both side-by-side).

**OQ3 — Exact Pro price points, intro offer, and whether backup auto-reminders stay free.** Product decisions, deferrable until the monetization phase.

## Verification (when this becomes active work)

- Phase 1: synced domain tests green in the mobile repo; web repo untouched (no CI impact by construction).
- Phase 2+: TestFlight on a physical iPhone at every phase exit.
- Phases 2–4: **math parity check** — same Supabase account on web and mobile must show identical net-worth / FIRE / allocation numbers.
- Phase 3: bearer-token web change verified by `api-auth-contract.test.ts` + full web CI + a production deploy before mobile depends on it.
- Phase 5: StoreKit sandbox purchase, cancel, and restore flows.
- Phase 7: Apple review with demo-account credentials in review notes.
