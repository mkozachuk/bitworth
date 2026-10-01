// Pure helpers for asset tags (slice B1a). No Supabase, no I/O: the API routes,
// the backup validator and the UI all share these rules, so a tag name means the
// same thing everywhere it is checked.

// Counted in Unicode code points (the same unit as Postgres `char_length`, which
// the tags.name CHECK uses), so an emoji counts as one character, not two.
export const TAG_NAME_MAX = 32;

export type TagNameResult = { ok: true; name: string } | { ok: false; message: string };

/**
 * Validate a raw tag name: it must be a string that is 1–32 characters long
 * once trimmed. Returns the trimmed name, which is the form that is stored.
 */
export function validateTagName(raw: unknown): TagNameResult {
  if (typeof raw !== "string") {
    return { ok: false, message: "name must be a string" };
  }
  const name = raw.trim();
  if (name.length === 0) {
    return { ok: false, message: "name must not be empty" };
  }
  if (Array.from(name).length > TAG_NAME_MAX) {
    return { ok: false, message: `name must be at most ${TAG_NAME_MAX} characters` };
  }
  return { ok: true, name };
}

/**
 * The key two tag names collide on. Names are unique per user regardless of
 * case, so "ETF" and "etf" are the same tag. The database index on
 * `lower(name)` is the final arbiter; this mirrors it for checks made before a
 * write.
 */
export function tagNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Names that occur more than once once case is ignored, each reported once in
 * the spelling it first appeared with. Empty when every name is distinct.
 */
export function duplicateTagNames(names: readonly string[]): string[] {
  const seen = new Map<string, string>();
  const dupes = new Map<string, string>();
  for (const name of names) {
    const key = tagNameKey(name);
    const first = seen.get(key);
    if (first === undefined) seen.set(key, name);
    else if (!dupes.has(key)) dupes.set(key, first);
  }
  return [...dupes.values()];
}

export interface TagChip {
  id: string;
  name: string;
}

/**
 * Group the user's asset↔tag links into one sorted chip list per asset id. A
 * link whose tag is not in `tags` is skipped (it cannot be named).
 */
export function tagsByAsset(
  tags: readonly TagChip[],
  links: readonly { asset_id: string; tag_id: string }[],
): Record<string, TagChip[]> {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const out: Record<string, TagChip[]> = {};
  for (const link of links) {
    const tag = byId.get(link.tag_id);
    if (!tag) continue;
    (out[link.asset_id] ??= []).push({ id: tag.id, name: tag.name });
  }
  for (const list of Object.values(out)) list.sort(compareTagNames);
  return out;
}

/** Case-insensitive name order, then by id so the order is total. */
export function compareTagNames(a: TagChip, b: TagChip): number {
  const byName = tagNameKey(a.name).localeCompare(tagNameKey(b.name));
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}
