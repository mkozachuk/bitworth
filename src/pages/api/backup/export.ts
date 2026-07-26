import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  serialize,
  USER_PREFERENCES_COLUMNS,
  ASSETS_COLUMNS,
  SNAPSHOTS_COLUMNS,
  SNAPSHOT_ITEMS_COLUMNS,
  GOALS_COLUMNS,
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

  // Fetch the four user-scoped tables. `snapshot_items` has no `user_id`; it
  // is owned transitively via `snapshot_id`, so it is fetched after we know the
  // user's snapshot ids. `goals` carries its own `user_id`, so it joins here.
  const [prefsRes, assetsRes, snapshotsRes, goalsRes] = await Promise.all([
    supabase.from("user_preferences").select(userPreferencesSelect).eq("user_id", user.id),
    supabase.from("assets").select(assetsSelect).eq("user_id", user.id),
    supabase.from("snapshots").select(snapshotsSelect).eq("user_id", user.id),
    supabase.from("goals").select(goalsSelect).eq("user_id", user.id),
  ]);

  if (prefsRes.error || assetsRes.error || snapshotsRes.error || goalsRes.error) {
    const message =
      (prefsRes.error ?? assetsRes.error ?? snapshotsRes.error ?? goalsRes.error)?.message ??
      "Failed to fetch backup data";
    return jsonError("FETCH_FAILED", message, 500);
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
