import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { validateEnvelope, prepareForImport } from "@/lib/backup";

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

function jsonError(code: string, message: string, status: number, context?: unknown): Response {
  const error = context === undefined ? { code, message } : { code, message, context };
  return new Response(JSON.stringify({ error } satisfies ErrorShape), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_MODES = ["replace", "merge"] as const;
type Mode = (typeof VALID_MODES)[number];

// POST /api/backup/import — orchestrate validate → prepare → atomic restore.
// All-or-nothing: nothing is written unless the whole envelope validates. The
// `restore_backup` RPC (SECURITY DEFINER) is the sole ownership boundary — it
// stamps user_id = auth.uid() itself, so the route never trusts any user_id/id
// in the body. UUID remapping happens in `prepareForImport` (pure, unit-tested),
// keeping the payload internally consistent before it reaches Postgres.
export const POST: APIRoute = async ({ request, cookies }) => {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const mode = raw.mode;
  if (typeof mode !== "string" || !VALID_MODES.includes(mode as Mode)) {
    return jsonError("VALIDATION_ERROR", `mode must be one of ${VALID_MODES.join(", ")}`, 400);
  }

  // Fetch the global category ids so validation can reject unknown ones BEFORE
  // any write (the RESTRICT FK is only the backstop). Validate-only — never
  // write asset_categories.
  const categoriesRes = await supabase.from("asset_categories").select("id");
  if (categoriesRes.error) {
    return jsonError("FETCH_FAILED", categoriesRes.error.message, 500);
  }
  const validCategoryIds = new Set((categoriesRes.data as { id: string }[]).map((c) => c.id));

  const validated = validateEnvelope(body, validCategoryIds);
  if (!validated.ok) {
    return jsonError(validated.code, validated.message, 400, validated.context);
  }

  const prepared = prepareForImport(validated.data, () => crypto.randomUUID());

  const { error } = await supabase.rpc("restore_backup", { p_mode: mode, p_data: prepared });
  if (error) {
    return jsonError("RESTORE_FAILED", "Failed to restore backup", 500, error.message);
  }

  return new Response(JSON.stringify({ data: { mode } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
