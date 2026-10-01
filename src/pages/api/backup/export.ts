import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  serialize,
  USER_PREFERENCES_COLUMNS,
  ASSETS_COLUMNS,
  SNAPSHOTS_COLUMNS,
  SNAPSHOT_ITEMS_COLUMNS,
  GOALS_COLUMNS,
  ALLOCATION_CARDS_COLUMNS,
  ALLOCATION_TARGETS_COLUMNS,
  TAGS_COLUMNS,
  ASSET_TAGS_COLUMNS,
  type BackupInput,
} from "@/lib/backup";

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } } satisfies ErrorShape), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Whitelisted column lists from `backup.ts` double as the PostgREST `select`
// projections — the file carries exactly the columns that round-trip.
const userPreferencesSelect = USER_PREFERENCES_COLUMNS.join(", ");
const assetsSelect = ASSETS_COLUMNS.join(", ");
const snapshotsSelect = SNAPSHOTS_COLUMNS.join(", ");
const snapshotItemsSelect = SNAPSHOT_ITEMS_COLUMNS.join(", ");
const goalsSelect = GOALS_COLUMNS.join(", ");
const allocationCardsSelect = ALLOCATION_CARDS_COLUMNS.join(", ");
const allocationTargetsSelect = ALLOCATION_TARGETS_COLUMNS.join(", ");
const tagsSelect = TAGS_COLUMNS.join(", ");
const assetTagsSelect = ASSET_TAGS_COLUMNS.join(", ");

export const GET: APIRoute = async ({ request, cookies }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return jsonError("UNAUTHORIZED", "Not authenticated", 401);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("UNAUTHORIZED", "Not authenticated", 401);
  }

  // Fetch the user-scoped tables. `snapshot_items` has no `user_id`; it is
  // owned transitively via `snapshot_id`, so it is fetched after we know the
  // user's snapshot ids. `goals`, both allocation tables and both tag tables
  // carry their own `user_id`, so they join here.
  const [prefsRes, assetsRes, snapshotsRes, goalsRes, cardsRes, targetsRes, tagsRes, assetTagsRes] = await Promise.all([
    supabase.from("user_preferences").select(userPreferencesSelect).eq("user_id", user.id),
    supabase.from("assets").select(assetsSelect).eq("user_id", user.id),
    supabase.from("snapshots").select(snapshotsSelect).eq("user_id", user.id),
    supabase.from("goals").select(goalsSelect).eq("user_id", user.id),
    supabase.from("allocation_cards").select(allocationCardsSelect).eq("user_id", user.id),
    supabase.from("allocation_targets").select(allocationTargetsSelect).eq("user_id", user.id),
    supabase.from("tags").select(tagsSelect).eq("user_id", user.id),
    supabase.from("asset_tags").select(assetTagsSelect).eq("user_id", user.id),
  ]);

  const fetchError =
    prefsRes.error ??
    assetsRes.error ??
    snapshotsRes.error ??
    goalsRes.error ??
    cardsRes.error ??
    targetsRes.error ??
    tagsRes.error ??
    assetTagsRes.error;
  if (fetchError) {
    return jsonError("FETCH_FAILED", fetchError.message, 500);
  }

  const snapshotIds = (snapshotsRes.data as unknown as { id: string }[]).map((s) => s.id);

  let snapshotItems: unknown[] = [];
  if (snapshotIds.length > 0) {
    const itemsRes = await supabase.from("snapshot_items").select(snapshotItemsSelect).in("snapshot_id", snapshotIds);
    if (itemsRes.error) {
      return jsonError("FETCH_FAILED", itemsRes.error.message, 500);
    }
    snapshotItems = itemsRes.data;
  }

  const input = {
    user_preferences: prefsRes.data,
    assets: assetsRes.data,
    snapshots: snapshotsRes.data,
    snapshot_items: snapshotItems,
    goals: goalsRes.data,
    allocation_cards: cardsRes.data,
    allocation_targets: targetsRes.data,
    tags: tagsRes.data,
    asset_tags: assetTagsRes.data,
  } as unknown as BackupInput;

  const exportedAt = new Date().toISOString();
  const envelope = serialize(input, exportedAt);

  // `yyyy-MM-dd` prefix so backups sort chronologically in a file listing.
  const filename = `${exportedAt.slice(0, 10)}-bitworth-export.json`;

  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
