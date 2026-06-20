import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  serialize,
  USER_PREFERENCES_COLUMNS,
  ASSETS_COLUMNS,
  SNAPSHOTS_COLUMNS,
  SNAPSHOT_ITEMS_COLUMNS,
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

  // Fetch the three user-scoped tables. `snapshot_items` has no `user_id`; it
  // is owned transitively via `snapshot_id`, so it is fetched after we know the
  // user's snapshot ids.
  const [prefsRes, assetsRes, snapshotsRes] = await Promise.all([
    supabase.from("user_preferences").select(userPreferencesSelect).eq("user_id", user.id),
    supabase.from("assets").select(assetsSelect).eq("user_id", user.id),
    supabase.from("snapshots").select(snapshotsSelect).eq("user_id", user.id),
  ]);

  if (prefsRes.error || assetsRes.error || snapshotsRes.error) {
    const message = (prefsRes.error ?? assetsRes.error ?? snapshotsRes.error)?.message ?? "Failed to fetch backup data";
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
  } as unknown as BackupInput;

  const envelope = serialize(input, new Date().toISOString());

  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="bitworth-backup.json"',
    },
  });
};
