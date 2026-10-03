import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { serializeSnapshotsCsv, snapshotCsvFilename, type CsvSnapshot, type CsvSnapshotItem } from "@/lib/snapshot-csv";

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } } satisfies ErrorShape), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// GET /api/snapshots/export.csv — the caller's snapshot history as a CSV
// attachment (long format, see `@/lib/snapshot-csv`). Read-only; the JSON
// backup at /api/backup/export stays the restore format.
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

  // `snapshots` and `tags` are filtered by `user_id` on top of RLS.
  // `asset_categories` is shared reference data (no owner). `snapshot_items`
  // has no `user_id`; it is owned through `snapshot_id`, so it is fetched only
  // for the caller's snapshot ids.
  const [snapshotsRes, tagsRes, categoriesRes] = await Promise.all([
    supabase
      .from("snapshots")
      .select("id, created_at, total_net_worth, display_currency, net_contribution, income")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase.from("tags").select("id, name").eq("user_id", user.id),
    supabase.from("asset_categories").select("id, name"),
  ]);

  const fetchError = snapshotsRes.error ?? tagsRes.error ?? categoriesRes.error;
  if (fetchError) {
    return jsonError("FETCH_FAILED", fetchError.message, 500);
  }

  const snapshots = (snapshotsRes.data ?? []) as CsvSnapshot[];
  const snapshotIds = snapshots.map((s) => s.id);

  let items: CsvSnapshotItem[] = [];
  if (snapshotIds.length > 0) {
    const itemsRes = await supabase
      .from("snapshot_items")
      .select(
        "snapshot_id, name, category_id, original_amount, original_currency, converted_amount, display_currency, display_order, tag_ids",
      )
      .in("snapshot_id", snapshotIds);
    if (itemsRes.error) {
      return jsonError("FETCH_FAILED", itemsRes.error.message, 500);
    }
    items = itemsRes.data;
  }

  const tagNames = Object.fromEntries(
    ((tagsRes.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]),
  );
  const categoryNames = Object.fromEntries(
    ((categoriesRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );

  const body = serializeSnapshotsCsv({ snapshots, items, categoryNames, tagNames });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${snapshotCsvFilename(new Date())}"`,
    },
  });
};
