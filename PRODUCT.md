# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: "Alex" — a privacy-conscious individual who tracks personal finances manually and refuses bank connections or third-party data access. Comfortable with spreadsheets but tired of their maintenance. Holds assets across PLN, USD, and EUR: cash accounts, investment funds, bonds, crypto, precious metals, and possibly hard assets. The monthly ritual: open the tool, update balances, save a snapshot, check the trend.

In practice the product's first real user is its owner (mak.kozachuk@gmail.com), who uses it for their own monthly net-worth ritual. It also serves as a portfolio piece demonstrating craft (built as a 10xDevs project) — polish is judged both by daily usefulness and by how it presents to a technical audience reviewing the work.

## Product Purpose

BitWorth replaces the net-worth spreadsheet. The user manually enters assets and liabilities across multiple currencies; the app converts everything to a chosen display currency with live exchange rates, saves monthly snapshots, charts the trend over time, and projects the path to financial independence (FIRE).

Success = the owner's monthly ritual is genuinely faster and more pleasant than the spreadsheet it replaced, and the product reads as an exemplary piece of work to anyone reviewing it.

## Positioning

Fully manual input — no bank connections, no aggregators — yet meaningfully better than a spreadsheet: automatic multi-currency conversion, one-click snapshots, and trend/projection charts with zero formula setup. Removing the manual-entry privacy stance would make it indistinguishable from a generic portfolio app; that stance is the wedge.

## Operating Context

- Monthly cadence: the core loop is entering balances and saving a snapshot roughly once a month, then reading the dashboard (total, deltas vs last month and Jan 1st, trend chart).
- Mobile-first PWA: installable on iOS/Android, launches standalone at `/dashboard`; the asset table reflows to cards on phones; offline fallback shell exists.
- Desktop browser remains a first-class surface (latest two versions of Chrome/Firefox/Safari/Edge).
- External data: exchange rates, crypto prices (CoinGecko), and gold/silver spot prices are fetched live with caching and graceful fallback — the UI must never break when an upstream API is down.

## Capabilities and Constraints

Shipped capability (roadmap S-01…S-21 all done): asset CRUD across 13 categories (liabilities negative), net worth with deltas, snapshots + trend chart, top movers, per-asset trends, live crypto and metals pricing, FIRE calculator + Monte Carlo simulation + FIRE progress card, net-worth trajectory projection, savings goals, asset balancer (declared vs real allocation, buy plan), allocation drift alerts, contributions-vs-growth split, backup import/export, settings (display currency PLN/USD/EUR, theme light/dark/system, dashboard card toggles), email/password auth, landing page.

Constraints and product facts:

- Privacy-first is non-negotiable: manual entry only, strict per-user row-level security, no cross-user data of any kind.
- Currencies are PLN, USD, EUR only (both for asset entry and display currency).
- Flat user model: one isolated account per user, no roles, no sharing, no teams.
- Tech: Astro v6 SSR + React 19 islands, Tailwind CSS v4, Supabase, Recharts, Radix UI + Lucide, deployed on Cloudflare Workers. Error shape is always `{ error: { code, message, context? } }`.
- Non-goals on record: no bank/broker integrations, no native mobile app, no inflation-adjusted figures, no historical exchange-rate series.
- Performance expectations: net worth visible within 2 s of page load; action feedback within 500 ms.
- Proposed next slices (undecided, not committed): snapshot reminder (S-22), category-mix trends (S-23), income/savings-rate (S-24).

## Brand Commitments

- **Name: BitWorth** — confirmed final (the repo recently completed a rename to it).
- **Visual world: "The Contents Map"** — chosen by the user (2026-07-26) in the rebrand direction round, from the ekiben-wrapper/kiosk tradition: warm kraft/cream paper grounds, deep indigo ink, vermilion seals and numbered markers, sage for growth, woodblock-flavored illustration always, photography never. The dashboard is an honestly-mapped box of what you own; snapshots are dated seals. DESIGN.md is the visual authority.
- **Theme order updated by that choice**: the canonical rendition is paper-light; dark ships as a committed "night ink" variant (indigo ink plate ground, paper-cream type), since the product retains its light/dark/system setting. This supersedes the earlier "dark theme primary" note.
- **English-only UI** — no i18n commitment.
- Existing tagline in use: "Your net worth, without the spreadsheet."

## Evidence on Hand

- Real product screenshots (paper-light canonical + night-ink dark variants, desktop + mobile) in `docs/screenshots/`, regenerated deterministically by `e2e/capture-screenshots.spec.ts` against seeded demo data.
- Foundation docs: `context/foundation/prd.md`, `roadmap.md`, `shape-notes.md`, `test-plan.md`.
- No testimonials, press, customer counts, or benchmarks exist — future work must not fabricate any.

## Product Principles

1. **Privacy is the product.** Every feature must work with manual input alone; nothing may require connecting an external account or sharing data.
2. **Beat the spreadsheet, keep its honesty.** Numbers are the user's own; the app adds conversion, memory, and visualization — never invented precision (no bridged chart gaps, no fabricated data points).
3. **One number, then context.** The dashboard leads with a single net worth figure; deltas, movers, and projections support it rather than compete with it.
4. **Degrade gracefully, always.** External price/rate APIs may fail at any time; cached values or manual entry take over without broken or blank UI.
5. **Monthly-ritual ergonomics.** The product is opened rarely and briefly; re-entry must be instant to re-learn, and the snapshot loop must stay short.

## Accessibility & Inclusion

No product-specific standard has been committed. Baseline expectation: the shipped Radix-based UI keeps keyboard operability and sensible semantics; charts must not rely on color alone where practical.
