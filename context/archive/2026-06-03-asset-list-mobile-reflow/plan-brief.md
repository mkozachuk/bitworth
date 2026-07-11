# AssetList Mobile Reflow — Plan Brief

> Full plan: `context/changes/asset-list-mobile-reflow/plan.md`
> Frame brief: — (no frame brief; this slice is well-scoped from the roadmap)
> Research: `context/changes/mobile-refactor/plan.md` (S-06 close-out, the responsive-design precedent)

## What & Why

`AssetList` renders as a `<table>` with four columns (Name, Amount, Category, Actions). On a 360px viewport, the table overflows horizontally and the actions are hard to reach. S-07 ships a card view for `<sm` so every asset is readable, the filter tabs still work, and Edit/Delete are reachable — all without horizontal scroll. The desktop table stays byte-identical; the change is purely additive.

## Starting Point

The mobile-fragile surfaces in the authed app (Topbar, AssetForm, NetWorthDisplay, dashboard sign-out) were resolved in S-06 (`mobile-refactor`, done). S-07 inherits the S-06 responsive primitive — `grid grid-cols-1 sm:grid-cols-2`, `hidden sm:block` / `sm:hidden` — and applies it to the last remaining hotspot: the asset list. The filter tabs and empty state are confirmed to fit at 360px; only the table itself needs to change.

## Desired End State

A user on a 360px viewport opening `/dashboard/assets` sees each asset as a card: name + amount on the top row, notes (single-line truncated) below the name, category with icon and `(liability)` tag, then a footer row with inline Edit + Delete links. Filter tabs and the empty state work the same as desktop. On `≥sm`, the table renders byte-identically to today.

## Key Decisions Made

| Decision                       | Choice                                                                                                | Why (1 sentence)                                                                                       | Source           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| Approach                       | Conditional render via CSS (separate `AssetCard` + CSS swap)                                          | Keeps the desktop `<table>` byte-identical and gives S-07 free rein over mobile semantics.            | Roadmap / change |
| Filter tabs                    | Leave unchanged                                                                                       | The three tabs fit at 360px without modification.                                                       | Roadmap          |
| Empty state                    | Single shared version, used by both viewports                                                         | Already centered with `py-16`; no overflow risk.                                                       | Roadmap          |
| Card field order               | Name + amount prominent at top, category as small label, actions in footer                            | Name and amount are the two most-looked-at fields on a list; putting them up top matches user intent. | Plan             |
| Card action UI                 | Inline icon+text Edit + Delete links (matches desktop)                                                | Familiar visual, no new gestures or menu.                                                              | Plan             |
| Notes display                  | Truncated single line (`line-clamp-1`)                                                                | Keeps the card tight; long notes don't dominate.                                                       | Plan             |
| Long content                   | Truncate name + notes; `tabular-nums` on amount                                                       | Prevents long names from breaking the card; tabular-nums keeps the amount column from reflowing.       | Plan             |
| Press feedback                 | Subtle `active:bg-…` tint on the card                                                                  | Small touch affordance without overdoing motion.                                                       | Plan             |
| Verification                   | Manual at 360px and 1280px + `npm run lint` + `npm run build`                                         | Matches S-06's verification precedent; E2E is deferred in the test plan.                               | Plan             |
| A11y / semantics               | Mobile view is a `<ul role="list">` of `<li>` cards; desktop stays a `<table>`                        | A list of items is a `<ul>`, not tabular data on narrow screens; `role="list"` defends against iOS Safari's `<ul>`-stripping bug. | Plan             |
| Dark mode                      | Mirror the existing card chrome (white/80 + dark:white/10), all `text-zinc-` paired with `dark:` variants | Parity with the desktop table colors and the page's card chrome.                                       | Plan             |

## Scope

**In scope:**
- New `src/components/assets/AssetCard.tsx` (mobile-only card view).
- `AssetList.tsx` edits to render both the existing `<table>` (wrapped in `hidden sm:block`) and a sibling `<ul>` of cards (`sm:hidden`).
- Visual polish and dark-mode parity pass on the new card.

**Out of scope:**
- Filter tab mobile treatment, mobile-specific empty state.
- 3-dot menu, swipe actions, whole-card-tappable-to-edit.
- PWA / install banner (S-08).
- Playwright / visual diff tooling — manual verification only, matching S-06.
- Refactoring `AssetRow` or sharing formatting helpers between the two views.

## Architecture / Approach

CSS-only viewport swap. Both branches live in the same `AssetList` render output. Tailwind's `hidden sm:block` (table) and `sm:hidden` (cards) pick the right one for the current viewport — no `useMediaQuery`, no resize listener, no hydration mismatch risk. The mobile branch uses `<ul role="list">` + `<li>` to preserve list semantics on iOS Safari, where Tailwind's `list-none` can strip the role.

```
+--------------------------------------------------+
| AssetList (React island, client:load)            |
|                                                  |
|  [Filter tabs: All | Assets | Liabilities]       |
|                                                  |
|  <div hidden sm:block>                           |
|    <table>  ... existing <AssetRow> loop ...     |
|  </div>                                          |
|                                                  |
|  <ul role="list" sm:hidden>                      |
|    <AssetCard />                                 |
|    <AssetCard />                                 |
|    ...                                           |
|  </ul>                                           |
+--------------------------------------------------+
```

## Phases at a Glance

| Phase     | What it delivers                                                                                 | Key risk                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 1. Ship   | New `AssetCard` component + CSS-swap in `AssetList` so `/dashboard/assets` is usable at 360px.    | Visual regression on desktop if the `<table>` wrapper or class accidentally changes.             |
| 2. Polish | Spacing tweaks, dark-mode parity audit, long-content truncation tuning.                          | Surface-level only — if Phase 1 needs structural rework, that lands in Phase 1, not Phase 2.      |

**Prerequisites:** `F-01`, `S-01`, `S-06` (all done).
**Estimated effort:** ~1 session, 2 phases, 2 commits.

## Open Risks & Assumptions

- **iOS Safari `<ul>` semantics.** Tailwind's `list-none` (or any `list-style: none`) can cause VoiceOver to drop the list role on iOS Safari. Mitigated by adding `role="list"` explicitly to the `<ul>`. If a future audit finds this still breaks, the fallback is `<div role="list">` + `<div role="listitem">` per item.
- **Long crypto quantity text** (e.g. `~0.00001234 BTC`) may wrap to a second line at 360px if the asset name is also long. The card allows wrap on the subline; the visual is acceptable. If a user reports a specific overflow, add a `truncate` to the subline — but that hides the value, so the default is "wrap, don't hide."
- **Per-row DOM doubles** (table row + card both rendered on every viewport). Cost is negligible for the typical 10-20 asset list. If a user has thousands of assets, this becomes a real cost — but the S-07 outcome is "phone-sized viewport," and any user with thousands of assets is on desktop.
- **Phase 2 is intentionally light.** It exists to catch the things Phase 1's manual check might miss (dark mode contrast on a specific color combination, spacing that looks fine in one browser and wrong in another). It is not a feature work phase.

## Success Criteria (Summary)

- A user on 360px can read every field of every asset, switch filter tabs, and reach Edit/Delete with no horizontal scroll.
- The desktop table at `≥sm` is byte-identical to the pre-S-07 baseline (the only diff in `AssetList.tsx` is the new wrapper + sibling `<ul>`; the `<table>` itself is untouched).
- `npm run lint` and `npm run build` pass on every commit.
