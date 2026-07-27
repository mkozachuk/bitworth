// Pure index math for the user-controlled asset order. No Supabase imports and
// no side effects — the reorder logic is exercised directly by unit tests
// rather than only through the DOM (mirrors the net-worth.ts / backup.ts
// pure-module convention).

// Relocate `activeId` to `overId`'s index, returning a NEW array. The input is
// never mutated — `react-compiler` is error-level in the components that call
// this, so the optimistic-update path must not touch the arrays it captured.
// A missing id (a stale drag against a list that changed underneath) or a
// self-move degrades to an unchanged copy rather than a scramble.
export function moveId(ids: readonly string[], activeId: string, overId: string): string[] {
  const next = [...ids];
  if (activeId === overId) return next;

  const from = next.indexOf(activeId);
  const to = next.indexOf(overId);
  if (from === -1 || to === -1) return next;

  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

// The `sort_order` a newly created asset should take so it lands in the top
// slot. Going one below the current minimum (rather than renumbering the whole
// list) keeps the insert a single write. Values are allowed to go negative and
// non-contiguous; only their relative order matters, and `reorder_assets`
// renumbers back to 0..N-1 on the next drag.
export function topSortOrder(existing: readonly number[]): number {
  if (existing.length === 0) return 0;
  return Math.min(...existing) - 1;
}
