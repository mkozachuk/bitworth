# AssetList Mobile Reflow Implementation Plan

## Overview

Ship the S-07 slice: reflow `AssetList` so that on a phone-sized viewport (~360px wide) every asset is readable, the All/Assets/Liabilities filter still works, and Edit/Delete are reachable — all without horizontal scrolling. The desktop `<table>` stays byte-identical; the change adds a separate `<ul>`-based card view for `<sm` and a CSS-only swap between the two.

## Current State Analysis

`AssetList` (`src/components/assets/AssetList.tsx:92-113`) renders a `<table>` with four columns (Name, Amount, Category, Actions). The card chrome in `index.astro:58` is `rounded-2xl border ... p-6` inside a `max-w-3xl px-4` wrapper, so at 360px the content area is ~264px — far narrower than the ~400px the table needs to render all four columns without compression. The table has no responsive classes anywhere on the `<table>`, `<thead>`, `<tr>`, or `<td>` elements.

`AssetRow.tsx:60-79` is the only row component. Its `Actions` cell holds inline Edit/Delete links with a `|` separator — no a11y concerns on desktop, but the icon+text pair is the right size to read at 360px once promoted to a card footer.

The filter tabs (`AssetList.tsx:62-79`) are three `px-4` text buttons. They fit at 360px without change. The empty state (`AssetList.tsx:81-90`) is a centered icon + 2 lines — also fine on mobile.

S-06 (`mobile-refactor`, done) established the responsive primitive the codebase uses everywhere: `grid grid-cols-1 sm:grid-cols-2` / `flex flex-col sm:flex-row` / `hidden sm:block`. S-07 inherits the same pattern. No new layout primitive, no new dependency, no API or schema change.

### Key Discoveries:

- The `AssetRow` is the only row component and is used once. Extracting the cell structure to a shared helper is not warranted; building a sibling `AssetCard` next to it is the smallest change.
- The `<table>` path uses `border-b border-zinc-200 last:border-0 dark:border-white/10` on each row (`AssetRow.tsx:19`). The new `AssetCard` should mirror this divider treatment so row separation reads the same on both viewports.
- The currency conversion logic in `AssetRow.tsx:16` (`convertAmount(...)`) and the amount-formatter block (L27-50) are pure functions of the props. They can be lifted to a shared helper if both `AssetRow` and `AssetCard` need them, but a simpler first cut is to duplicate the small amount block — the formatter is 4 lines and the conversion is 1 line. Plan assumes duplication; if Phase 1 surfaces friction, lift to a shared helper in Phase 2.
- The list is mounted as a React island via `client:load` (`index.astro:63`). No new island is needed; `AssetList` stays the single island and renders both branches.

## Desired End State

After this plan ships, a user on a 360px viewport opening `/dashboard/assets` can:

1. See the page header ("Assets" + "+ Add Asset") rendered by `index.astro` (already fits at 360px after S-06).
2. See the All/Assets/Liabilities filter tabs (unchanged from desktop).
3. See each asset as a card showing: name (truncated), notes (single-line truncated), amount (displayCurrency, with `tabular-nums`), category (icon + name + `(liability)` tag when applicable), and a footer row with inline Edit + Delete links.
4. Tap Edit to navigate to `/dashboard/assets/{id}/edit`; tap Delete to confirm-then-delete via the existing `handleDelete` flow (`AssetList.tsx:28-46`).
5. Switch filter tabs to scope the list to Assets or Liabilities — works the same as desktop.
6. See the empty state ("No assets yet" / "No {filter} found") when the filtered list is empty — same content as desktop, shared render.

On a desktop viewport (≥1024px), the `<table>` renders byte-identically to the pre-S-07 state. No class added, removed, or reordered on the table path.

### Verification:

- Manual browser check at 360px and 1280px for `/dashboard/assets` with at least one asset, one liability, and one with notes.
- `npm run lint` and `npm run build` pass on every commit.
- Desktop visual diff (≥1024px): the existing `<table>` markup is byte-identical to the pre-S-07 baseline (the only edits to `AssetList.tsx` add the new mobile branch in parallel with the existing table; the table itself is untouched).

## What We're NOT Doing

- **Filter tab mobile treatment** — the three tabs fit at 360px. Leave as-is.
- **Empty state mobile variant** — the existing empty state is already centered with `py-16`, no overflow risk. Single component, used by both viewports.
- **PWA / install banner** — out of scope (S-08).
- **Whole-card-tappable-to-edit** — only the Edit and Delete links trigger navigation. Avoids a UX surprise vs. desktop where the row isn't tappable.
- **3-dot menu, swipe actions, or other mobile-native gestures** — out of scope; the inline Edit + Delete links mirror the desktop visual.
- **Visual diff tooling (Playwright, Storybook)** — out of scope per `user-settings/plan-brief.md` "Out of scope" §9. Verification is manual at 360px and 1280px.
- **Refactoring `AssetRow` or sharing formatting helpers** — duplication is acceptable for the small amount/category block; revisit only if Phase 1 surfaces friction.
- **Crypto quantity text styling** — keep the small `~0.0023 BTC` line that `AssetRow.tsx:37-50` renders under the converted amount. The mobile card shows it on a separate line, same color/size.

## Implementation Approach

**Conditional render via CSS, not JS.** Both branches live in the same `AssetList` render output. Each row of the existing `<table>` gets `hidden sm:table-row`; each card gets `sm:hidden`. The Tailwind `sm:` breakpoint (640px) is the codebase standard and matches S-06.

**New `AssetCard` component.** Sibling to `AssetRow` in `src/components/assets/`. Renders a `<li>` containing the four fields plus a footer with the actions. Same `asset`, `onDelete`, `displayCurrency`, `rates` props as `AssetRow` — no new prop surface.

**Outer container swap.** The existing `<table>` stays inside the render. The mobile view is a `<ul>` rendered as a sibling to (not a replacement of) the table. The CSS hides one and shows the other based on the `sm:` breakpoint. This preserves every screen-reader semantic the desktop table has, while letting the mobile branch use the more natural `<ul>`/`<li>` semantic for a list of items.

**A11y.** The mobile `<ul>`/`<li>` branch is a list of items, not tabular data — `<ul>` is the right element. Each card's name and amount are visually prominent (no `<th>` equivalent). Edit and Delete stay as `<a>` and `<button>` like the desktop, so focus order and keyboard navigation work the same.

## Critical Implementation Details

- **CSS-only viewport swap, not a media-query hook.** The existing pattern in this codebase (S-06) is class-based: `hidden sm:flex`, `flex sm:hidden`. A `useMediaQuery` listener would introduce resize handlers and hydration mismatch risk on SSR. The CSS approach renders both branches on every viewport; Tailwind hides the wrong one. Cost: ~1× extra DOM per row. Worth it for zero JS.
- **`<ul>` vs `<div role="list">` on iOS Safari.** iOS Safari strips list semantics from `<ul>` if `list-style: none` is applied without a fallback. Tailwind's `list-none` removes the bullet. To preserve the semantic list, either keep the default browser bullets (ugly), set `list-style-position: inside` + a custom marker, or skip the bullets with `list-none` and add `role="list"` to the `<ul>`. The simplest fix: apply `role="list"` to the `<ul>` regardless. This is a known iOS Safari quirk; the rest of the codebase doesn't currently use `<ul>` in client components, so this is the first place the rule applies.
- **Dark mode parity.** The desktop table uses `border-zinc-200 dark:border-white/10` and `text-zinc-900 dark:text-white`. The new card uses the same color tokens so light/dark mode reads consistently. The `AssetRow` is *inside* the card chrome (`index.astro:58`'s `rounded-2xl border ... bg-white/80 dark:bg-white/10`) — the cards sit on top of that chrome, so the card itself should not add a background; a hairline border bottom is enough.

## Phase 1: Ship the mobile card

### Overview

Create `src/components/assets/AssetCard.tsx` for the `<sm` branch. Edit `AssetList.tsx` to render the existing `<table>` AND a sibling `<ul>` of cards, with Tailwind visibility classes swapping between them. Desktop `<table>` markup stays byte-identical. Single commit.

### Changes Required:

#### 1. Create `AssetCard` component

**File**: `src/components/assets/AssetCard.tsx` (new)

**Intent**: Render a single asset as a mobile card inside the `<ul>` branch. Mirrors the field set of `AssetRow` but laid out as a vertical card: name + notes at the top, amount + currency badge + category in the middle, Edit/Delete in a footer row.

**Contract**:
- Default-exported React component (matches `AssetRow`).
- Props: `{ asset: AssetWithCategory; onDelete: (id: string) => void; displayCurrency: Currency; rates: Record<Currency, number> }` — same shape as `AssetRow`'s props.
- Renders a `<li>` (not a `<tr>`). The parent `<ul>` in `AssetList` provides the role.
- Top row: `<div className="flex items-baseline justify-between gap-2">` containing the name (`<span className="font-medium text-zinc-900 dark:text-white truncate min-w-0">`) and the amount (`<span className="... tabular-nums shrink-0">`).
- Below the name: notes paragraph with `line-clamp-1 text-xs text-zinc-500 dark:text-white/50`.
- Below the amount: crypto quantity line (matches `AssetRow.tsx:37-50`) OR currency line, with `text-xs text-zinc-500 dark:text-white/40 tabular-nums`.
- Below: category row (`<div className="mt-2 flex items-center gap-1.5 text-sm text-zinc-700 dark:text-white/70">`) with the category icon, name, and `(liability)` tag.
- Footer: `<div className="mt-3 flex items-center gap-2 border-t border-zinc-200 pt-3 dark:border-white/10">` containing the Edit `<a>` and Delete `<button>` (copied from `AssetRow.tsx:60-79` with the same Tailwind classes, except the surrounding `<td>` wrapper is gone).
- The `<li>` itself: `className="border-b border-zinc-200 last:border-0 dark:border-white/10 active:bg-zinc-50 dark:active:bg-white/5 transition-colors"`. The `active:` provides the press feedback agreed during planning; the `transition-colors` keeps it subtle.
- The amount color follows the `is_liability` rule: red when liability, default otherwise. Use the same class string as `AssetRow.tsx:28-34`.
- The converted amount uses the same formatter as `AssetRow.tsx:32` (`toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`).

A code snippet for the Edit/Delete footer is justified — the surrounding `<td>` wrapper is gone, so the implementer must NOT copy the `<tr>`/`<td>` shell:

```tsx
<div className="mt-3 flex items-center gap-2 border-t border-zinc-200 pt-3 dark:border-white/10">
  <a
    href={`/dashboard/assets/${asset.id}/edit`}
    className="flex items-center gap-1 text-sm text-purple-600 transition-colors hover:text-purple-800 dark:text-purple-300 dark:hover:text-purple-200"
  >
    <Pencil className="size-3.5" />
    Edit
  </a>
  <span className="text-zinc-300 dark:text-white/20">|</span>
  <button
    type="button"
    onClick={() => {
      onDelete(asset.id);
    }}
    className="flex items-center gap-1 text-sm text-red-600 transition-colors hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
  >
    <Trash2 className="size-3.5" />
    Delete
  </button>
</div>
```

#### 2. Render both branches in `AssetList`

**File**: `src/components/assets/AssetList.tsx`

**Intent**: Add the `<ul>` of cards as a sibling of the existing `<table>`. Tailwind classes swap visibility between the two based on the `sm:` breakpoint. The `<table>` markup itself is byte-identical.

**Contract**:
- Add the import: `import { AssetCard } from "./AssetCard";` next to the existing `import { AssetRow } from "./AssetRow";` at `AssetList.tsx:3`.
- Replace the `filtered.length === 0` ternary (`AssetList.tsx:81-113`) with a block that renders three children: the empty state (unchanged), the `<table>` (unchanged), and a sibling `<ul>`.
- Wrap the existing `<table>` in `<div className="hidden sm:block">…</div>` so it shows only on `≥sm`.
- Add a sibling `<ul role="list" className="sm:hidden">` containing the `filtered.map(...)` over `<AssetCard … />`. Each card inherits the divider from its own className (no extra wrapper needed).
- The empty state remains outside both branches — it is the same component, used by both viewports, with no `sm:` toggle.
- No changes to the `<table>`, `<thead>`, `<tr>` markup, the column headers, or the `<AssetRow>` invocation.

A snippet for the new top-level structure:

```tsx
{filtered.length === 0 ? (
  /* unchanged empty state */
) : (
  <>
    <div className="hidden sm:block">
      <table className="w-full">
        {/* byte-identical: thead + AssetRow loop */}
      </table>
    </div>
    <ul role="list" className="sm:hidden">
      {filtered.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          onDelete={handleDelete}
          displayCurrency={displayCurrency}
          rates={rates}
        />
      ))}
    </ul>
  </>
)}
```

The `key={asset.id}` is reused (one branch is hidden, so React's reconciliation is unaffected by both branches sharing the same id).

#### 3. Verify desktop byte-identical

**File**: `src/components/assets/AssetList.tsx` (read-only check)

**Intent**: Confirm the existing `<table>` markup is unchanged. The only edit to this section is wrapping it in `<div className="hidden sm:block">` and adding the sibling `<ul>`; the table's own classes and DOM are untouched.

**Contract**: After the edit, the `git diff` of the `<table>` opening tag, every `<tr>` / `<th>` / `<td>` attribute, and the `<AssetRow>` call must be empty. Only the surrounding wrapper class and the new sibling `<ul>` should appear in the diff.

### Success Criteria:

#### Automated Verification:

- 1.1 `npm run lint` passes
- 1.2 `npm run build` passes
- 1.3 `git diff` on `src/components/assets/AssetList.tsx` shows changes only to (a) the new import line, (b) the wrapper around the existing `<table>`, and (c) the new sibling `<ul>`. The `<table>` element's attributes and its child `<thead>` / `<tbody>` are unchanged.
- 1.4 `src/components/assets/AssetCard.tsx` exists and exports a default React component.

#### Manual Verification:

- 1.5 Open `/dashboard/assets` at a 1280px viewport with at least one asset, one liability, and one asset with notes. The page renders identically to the pre-S-07 baseline — same column headers, same row borders, same Edit/Delete links.
- 1.6 Open `/dashboard/assets` at a 360px viewport with the same data. Each asset renders as a card: name + amount on the first row, notes (truncated to one line) below the name, category with its icon and `(liability)` tag when applicable, and Edit/Delete in a footer row. No horizontal scroll. Tapping Edit navigates to the edit page. Tapping Delete shows the existing `confirm()` dialog and removes the row on confirm.
- 1.7 Toggle filter tabs (All / Assets / Liabilities) at 360px. The card list updates immediately; the active tab's underline remains visible.
- 1.8 Open `/dashboard/assets` at 360px with no assets. The empty state ("No assets yet" + "Add your first asset to get started") is centered and readable; no card list is shown.
- 1.9 Press-and-hold feedback: tap a card and release at 360px. A subtle background tint appears on press and clears on release. The card itself is not tappable to navigate (only the Edit link and Delete button trigger actions).
- 1.10 Resize the viewport from 360px to 1280px and back. The branch swap happens at the `sm:` breakpoint (640px) with no flash of the wrong content (no React hydration mismatch in the console).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Visual polish + dark-mode parity

### Overview

After Phase 1 lands, audit the card on a 360px viewport in both light and dark mode, against at least one asset of each kind (regular asset, liability, asset with notes, asset with crypto). Tighten spacing, line-clamp behavior, and the divider treatment if anything looks off. The desktop table path is not in scope for this phase.

### Changes Required:

#### 1. Audit card spacing

**File**: `src/components/assets/AssetCard.tsx`

**Intent**: Verify the vertical rhythm — name → notes → amount → crypto/currency line → category → divider → actions — reads cleanly on a 360px viewport in both themes. Adjust `mt-*` values if any section feels cramped or has too much air.

**Contract**: Any spacing tweak stays inside `AssetCard.tsx`. The `mt-2` between amount and category, `mt-3` on the footer, and the `gap-2` on the footer row are the most likely candidates for adjustment. If the notes paragraph crowds the name on long names, switch from `line-clamp-1` to `line-clamp-2` on notes.

#### 2. Dark-mode parity pass

**File**: `src/components/assets/AssetCard.tsx`

**Intent**: Confirm every text/border class has a `dark:` variant that matches the existing card chrome (`index.astro:58`'s `bg-white/80 dark:bg-white/10`) and the `AssetRow` colors.

**Contract**: All `text-zinc-*` and `border-zinc-*` classes must have a sibling `dark:text-white/*` or `dark:border-white/*` variant. The `active:bg-zinc-50` press state must have a `dark:active:bg-white/5` variant. A grep over the new file should show no `text-zinc-` or `border-zinc-` without a matching `dark:` variant.

#### 3. Crypto + currency line review

**File**: `src/components/assets/AssetCard.tsx`

**Intent**: Verify the small "0.0023 BTC" or "100.00 USD" subline under the amount reads as secondary text, not as the primary amount.

**Contract**: The subline uses `text-xs text-zinc-500 dark:text-white/40 tabular-nums` (matching `AssetRow.tsx:38, 46`). If the visual hierarchy is wrong (subline looks as prominent as the primary amount), reduce its opacity or size.

### Success Criteria:

#### Automated Verification:

- 2.1 `npm run lint` passes
- 2.2 `npm run build` passes
- 2.3 Grep over `AssetCard.tsx` for `text-zinc-` and `border-zinc-` returns zero hits without a `dark:` sibling on the same class string.
- 2.4 Desktop (`≥sm`) path in `AssetList.tsx` is unchanged from end of Phase 1.

#### Manual Verification:

- 2.5 Open `/dashboard/assets` at 360px with one asset, one liability, and one crypto asset. Light mode: spacing between name / amount / category / actions feels even. Dark mode: every text and border color matches the rest of the card chrome (no near-white text on near-white background, no missing contrast on the `(liability)` tag or the crypto subline).
- 2.6 Add an asset with a long name (>30 chars) and a long note (>80 chars) via the existing form. At 360px, the name truncates with an ellipsis; the notes paragraph truncates to a single line with an ellipsis. No card extends past the viewport width.
- 2.7 Confirm `git diff` on `AssetList.tsx` since end of Phase 1 is empty (the desktop table is still byte-identical).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- No new unit tests in this slice. The `AssetList` filter logic and `handleDelete` are unchanged; they continue to be covered by existing tests where any exist. The new `AssetCard` is presentational only (no business logic, no API calls).

### Integration Tests:

- No new integration tests. The mobile reflow is a CSS-only branch swap; the integration concern (delete succeeds, edit navigates) is already exercised by manual click-through.

### Manual Testing Steps:

1. **At 1280px (desktop parity):**
   - Open `/dashboard/assets` with a mix of regular assets, liabilities, crypto assets, and assets with notes.
   - Compare to the pre-S-07 baseline. The table, headers, row borders, action links, and filter tab styling should be byte-identical.
2. **At 360px (mobile):**
   - Open `/dashboard/assets` with the same data. Each asset is a card; no horizontal scroll.
   - Tap Edit on a card → navigates to the edit page.
   - Tap Delete on a card → confirm dialog appears → confirm → row is removed.
   - Switch filter tabs (All / Assets / Liabilities). The list updates; the active tab's underline is visible.
   - With no assets: the empty state shows ("No assets yet" / "No {filter} found").
3. **Resize test:**
   - Resize the viewport from 360px to 1280px and back. Branch swap happens cleanly at the `sm:` breakpoint.
4. **Long-content test:**
   - Add an asset with a 30+ char name and an 80+ char note. At 360px, name and notes both truncate cleanly.
5. **Dark mode:**
   - Toggle dark mode. Every text and border in the card reads with appropriate contrast. No flash of light theme on first paint.

## Performance Considerations

- The CSS swap doubles the per-row DOM (table row + card), but Tailwind's `hidden` / `sm:hidden` adds no runtime cost. React still re-renders both branches when the filter changes, which is what already happens for the table today.
- No new bundle code beyond `AssetCard.tsx` (~70 lines). No new dependencies.
- The list still re-renders on filter change; no memoization needed for the typical case (a dozen assets). The existing `AssetRow` is not memoized, and the new `AssetCard` follows the same precedent.

## Migration Notes

No data migration. No schema changes. No API changes. The mobile card is a pure render-time decision based on the viewport breakpoint.

## References

- Roadmap entry: `context/foundation/roadmap.md` §S-07 (lines 150-163)
- Upstream change notes: `context/changes/asset-list-mobile-reflow/change.md`
- S-06 (precedent for the responsive pattern): `context/changes/mobile-refactor/plan.md`
- Component under change: `src/components/assets/AssetList.tsx:92-113`
- Sibling row component (visual source of truth): `src/components/assets/AssetRow.tsx`
- Page wrapper: `src/pages/dashboard/assets/index.astro:58`
- Lessons applied:
  - **Responsive primitive** — use `hidden sm:block` / `sm:hidden` (S-06 pattern); avoid `useMediaQuery` hydration cost
  - **No new components when the existing one works** — S-07's `AssetCard` is genuinely new (no row → card path exists), so this rule doesn't suppress it
  - **Keep desktop byte-identical** — the wrapper goes around the `<table>`, not through it

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Ship the mobile card

#### Automated

- [x] 1.1 `npm run lint` passes — 21ee2d4
- [x] 1.2 `npm run build` passes — 21ee2d4
- [x] 1.3 `git diff` on `src/components/assets/AssetList.tsx` shows changes only to the new import, the wrapper around the existing `<table>`, and the new sibling `<ul>`. The `<table>` element's attributes and its child `<thead>` / `<tbody>` are unchanged. — 21ee2d4
- [x] 1.4 `src/components/assets/AssetCard.tsx` exists and exports a default React component. — 21ee2d4

#### Manual

- [x] 1.5 Open `/dashboard/assets` at a 1280px viewport — desktop table renders byte-identically to the pre-S-07 baseline. — 21ee2d4
- [x] 1.6 Open `/dashboard/assets` at 360px — each asset renders as a card with the agreed field order, truncation, and Edit/Delete footer. No horizontal scroll. — 21ee2d4
- [x] 1.7 Filter tabs (All / Assets / Liabilities) at 360px — list updates and active tab underline remains visible. — 21ee2d4
- [x] 1.8 Empty state at 360px — centered "No assets yet" / "No {filter} found" message. — 21ee2d4
- [x] 1.9 Press-and-hold feedback at 360px — subtle background tint on press; card itself not tappable to navigate. — 21ee2d4
- [x] 1.10 Resize 360px ↔ 1280px — branch swap happens at `sm:` breakpoint with no console hydration mismatch. — 21ee2d4

### Phase 2: Visual polish + dark-mode parity

#### Automated

- [x] 2.1 `npm run lint` passes
- [x] 2.2 `npm run build` passes
- [x] 2.3 Grep over `AssetCard.tsx` for `text-zinc-` and `border-zinc-` returns zero hits without a `dark:` sibling on the same class string.
- [x] 2.4 Desktop (`≥sm`) path in `AssetList.tsx` is unchanged from end of Phase 1.

#### Manual

- [ ] 2.5 360px in light + dark mode — spacing, contrast, and `(liability)` / crypto subline all read clearly.
- [ ] 2.6 Long-name + long-note asset at 360px — name and notes truncate cleanly with an ellipsis.
- [ ] 2.7 `git diff` on `AssetList.tsx` since end of Phase 1 is empty.
