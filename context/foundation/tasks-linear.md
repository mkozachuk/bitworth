---
project: BitWorth
derived_from: context/foundation/roadmap.md
created: 2026-05-26
---

# Linear — Roadmap Mapping

> Linear is the **authoritative home** for BitWorth roadmap tracking.
> This document is the authoritative index; it is updated when issues change state.
> See also: [GitHub issues](context/foundation/tasks-github.md) (cross-linked, no longer primary).

## Workspace

**Linear:** [linear.app/bitworth](https://linear.app/bitworth)
**Team:** BitWorth (`839843fd-c1b0-41ea-bb25-e73cd5138b66`)
**Key:** `BIT`
**Project:** [Roadmap](https://linear.app/bitworth/project/roadmap-2e5bcdc2d5be) (`c5a3b8b9-e29e-428a-a2ad-18b64d1065ac`)

## Milestones

| Linear ID | Name | Description | Progress |
|---|---|---|---|
| `6e993ea7` | M1: Foundation | PostgreSQL schema, migrations, and seed data for assets, snapshots, and user preferences. | 0% |
| `15186267` | M2: Core tracking | Asset CRUD with currency conversion. | 0% |
| `ee645cec` | M3: Dashboard | Net worth display, delta indicators, snapshot save, and trend chart. | 0% |
| `a6bc19db` | M4: Crypto integration | Live BTC/ETH/altcoin price fetch on asset entry via CoinGecko. | 0% |
| `c95c8b35` | Backlog | Pre-work questions and parked items needing resolution before engineering starts. | 0% |

All milestones live under the **Roadmap** project. No hierarchical milestones — Linear does not support nested milestones. The Backlog milestone holds Q1–Q5 (open questions). There is no explicit MVP milestone; it is implicit once all four delivery milestones are complete.

## Roadmap Issues

| Roadmap ID | Linear ID | Title | Milestone | Priority | Blocked by | GitHub |
|---|---|---|---|---|---|---|
| F-01 | BIT-5 | [Foundation] F-01: Supabase schema and migrations | M1: Foundation | High | — | [#2](https://github.com/mkozachuk/bitworth/issues/2) |
| S-01 | BIT-6 | [Slice] S-01: Asset management with currency conversion | M2: Core tracking | High | BIT-5 (F-01) | [#3](https://github.com/mkozachuk/bitworth/issues/3) |
| S-02 | BIT-7 | [Slice] S-02: Dashboard — net worth display, snapshots, and trend chart | M3: Dashboard | High | BIT-6 (S-01) | [#4](https://github.com/mkozachuk/bitworth/issues/4) |
| S-03 | BIT-8 | [Slice] S-03: Crypto price fetch on asset entry | M4: Crypto integration | High | BIT-5 (F-01) | [#5](https://github.com/mkozachuk/bitworth/issues/5) |

### Issue details

**BIT-5 — F-01: Supabase schema and migrations**
- [linear.app/bitworth/issue/BIT-5](https://linear.app/bitworth/issue/BIT-5)
- Change ID: `supabase-schema-migrations`
- Labels: `foundation`
- PRD refs: FR-006–010, FR-011, FR-014, FR-016, FR-017, FR-019; NFR §data-privacy
- Unlocks: S-01, S-02, S-03
- Risks: single point of failure for all downstream slices — keep minimal

**BIT-6 — S-01: Asset management with currency conversion**
- [linear.app/bitworth/issue/BIT-6](https://linear.app/bitworth/issue/BIT-6)
- Change ID: `asset-management`
- Labels: `slice`
- PRD refs: US-03, FR-006–010
- Risks: exchange rate API fallback (FR-013) must ship concurrently

**BIT-7 — S-02: Dashboard — net worth display, snapshots, and trend chart**
- [linear.app/bitworth/issue/BIT-7](https://linear.app/bitworth/issue/BIT-7)
- Change ID: `dashboard-snapshots-chart`
- Labels: `slice`
- PRD refs: US-01, FR-011–018
- Unknowns: snapshot auto-save trigger (Q3)
- Risks: charting library decision (Chart.js/Recharts/visx), NFR §2s-load

**BIT-8 — S-03: Crypto price fetch on asset entry**
- [linear.app/bitworth/issue/BIT-8](https://linear.app/bitworth/issue/BIT-8)
- Change ID: `crypto-price-fetch`
- Labels: `slice`
- PRD refs: FR-019, FR-020
- Runs parallel with S-01 and S-02 after F-01 lands
- Risks: CoinGecko rate limits — debounce + aggressive caching required

## Question Issues

| Roadmap ID | Linear ID | Title | Priority | Labels | GitHub |
|---|---|---|---|---|---|
| Q1 | BIT-9 | Exchange rate API — frankfurter.app vs alternatives | Medium | `question` | [#6](https://github.com/mkozachuk/bitworth/issues/6) |
| Q2 | BIT-10 | Crypto price API — CoinGecko free tier | Medium | `question` | [#7](https://github.com/mkozachuk/bitworth/issues/7) |
| Q3 | BIT-11 | Snapshot auto-save trigger — first-login-of-month vs fixed day-of-month | Medium | `question` | [#8](https://github.com/mkozachuk/bitworth/issues/8) |
| Q4 | BIT-12 | Display currency persistence — per-user vs session | Medium | `question` | [#9](https://github.com/mkozachuk/bitworth/issues/9) |
| Q5 | BIT-13 | Demo mode scope — sample data composition | Low | `question`, `nice-to-have` | [#10](https://github.com/mkozachuk/bitworth/issues/10) |

All question issues live in the **Backlog** milestone under the Roadmap project. All are assigned to `me` and owned by `user`.

### Question issue details

**BIT-9 — Q1: Exchange rate API**
- [linear.app/bitworth/issue/BIT-9](https://linear.app/bitworth/issue/BIT-9)
- Options: frankfurter.app (EUR base, no key), Open Exchange Rates (more currencies), Exchangerate.host
- Needed by: F-01

**BIT-10 — Q2: Crypto price API**
- [linear.app/bitworth/issue/BIT-10](https://linear.app/bitworth/issue/BIT-10)
- Leading candidate: CoinGecko (free, no key, BTC/ETH/altcoins)
- Needed by: F-01

**BIT-11 — Q3: Snapshot auto-save trigger**
- [linear.app/bitworth/issue/BIT-11](https://linear.app/bitworth/issue/BIT-11)
- Options: first-login-of-month vs fixed day-of-month
- Manual trigger ships regardless; auto-save is secondary
- Needed by: S-02

**BIT-12 — Q4: Display currency persistence**
- [linear.app/bitworth/issue/BIT-12](https://linear.app/bitworth/issue/BIT-12)
- Recommended: per-user in `user_preferences` table
- Needed by: F-01

**BIT-13 — Q5: Demo mode scope**
- [linear.app/bitworth/issue/BIT-13](https://linear.app/bitworth/issue/BIT-13)
- Labels: `question`, `nice-to-have`
- Parked post-MVP
- Needed by: post-MVP

## Labels

| Label | Color | Linear ID | Applies to |
|---|---|---|---|
| `foundation` | #6B7280 | `b92b66a2` | F-01 |
| `slice` | #2563EB | `84fc658c` | S-01, S-02, S-03 |
| `question` | #F59E0B | `900d3f4f` | Q1–Q5 |
| `nice-to-have` | #9333EA | `f16917cc` | Q5 |
| `Improvement` | #4EA7FC | `fb0b8a5d` | (GH default, unused) |
| `Feature` | #BB87FC | `d5ebba96` | (GH default, unused) |
| `Bug` | #EB5757 | `7d4fd917` | (GH default, unused) |

## Dependency Chain

```
BIT-5 (F-01)  ──┬──► BIT-6 (S-01)  ──► BIT-7 (S-02)
                 └──► BIT-8 (S-03)
                       ↑
                  (parallel with S-01, S-02)
```

All dependencies are wired as Linear **blocking relations**:
- **BIT-6** (`blockedBy`: BIT-5)
- **BIT-7** (`blockedBy`: BIT-6)
- **BIT-8** (`blockedBy`: BIT-5)

The `blocks` relation is automatically set on the inverse side by Linear.

## GitHub Cross-Links

Each Linear issue body includes a `**GitHub:** [#N](url)` reference. Each GitHub issue has a comment linking back to its Linear counterpart:

| GitHub | Linear | Comment URL |
|---|---|---|
| [#2](https://github.com/mkozachuk/bitworth/issues/2) | BIT-5 | [#issuecomment-4545145135](https://github.com/mkozachuk/bitworth/issues/2#issuecomment-4545145135) |
| [#3](https://github.com/mkozachuk/bitworth/issues/3) | BIT-6 | [#issuecomment-4545145520](https://github.com/mkozachuk/bitworth/issues/3#issuecomment-4545145520) |
| [#4](https://github.com/mkozachuk/bitworth/issues/4) | BIT-7 | [#issuecomment-4545145899](https://github.com/mkozachuk/bitworth/issues/4#issuecomment-4545145899) |
| [#5](https://github.com/mkozachuk/bitworth/issues/5) | BIT-8 | [#issuecomment-4545146193](https://github.com/mkozachuk/bitworth/issues/5#issuecomment-4545146193) |
| [#6](https://github.com/mkozachuk/bitworth/issues/6) | BIT-9 | [#issuecomment-4545146426](https://github.com/mkozachuk/bitworth/issues/6#issuecomment-4545146426) |
| [#7](https://github.com/mkozachuk/bitworth/issues/7) | BIT-10 | [#issuecomment-4545147029](https://github.com/mkozachuk/bitworth/issues/7#issuecomment-4545147029) |
| [#8](https://github.com/mkozachuk/bitworth/issues/8) | BIT-11 | [#issuecomment-4545147288](https://github.com/mkozachuk/bitworth/issues/8#issuecomment-4545147288) |
| [#9](https://github.com/mkozachuk/bitworth/issues/9) | BIT-12 | [#issuecomment-4545147586](https://github.com/mkozachuk/bitworth/issues/9#issuecomment-4545147586) |
| [#10](https://github.com/mkozachuk/bitworth/issues/10) | BIT-13 | [#issuecomment-4545147875](https://github.com/mkozachuk/bitworth/issues/10#issuecomment-4545147875) |

## Links

- [Linear workspace](https://linear.app/bitworth)
- [Roadmap project](https://linear.app/bitworth/project/roadmap-2e5bcdc2d5be)
- [Roadmap source](context/foundation/roadmap.md)
- [GitHub mapping reference](context/foundation/tasks-github.md)
