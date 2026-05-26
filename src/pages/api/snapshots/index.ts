import type { APIRoute } from "astro";
import { createDbClient } from "@/lib/db";

export const GET: APIRoute = async ({ request, cookies }) => {
  const db = createDbClient(request.headers, cookies);
  if (!db) {
    return new Response(JSON.stringify({ error: { code: "SERVER_ERROR", message: "Database unavailable" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: snapshots, error } = await db
    .from("snapshots")
    .select("*")
    .eq("user_id", user.id)
    .order("snapshot_date", { ascending: true });

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_ERROR", message: "Failed to fetch snapshots", context: error } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ data: snapshots }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const db = createDbClient(request.headers, cookies);
  if (!db) {
    return new Response(JSON.stringify({ error: { code: "SERVER_ERROR", message: "Database unavailable" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { saveSnapshot } = await import("@/lib/snapshot");

  // Get user's display currency preference
  const { data: profile } = await db.from("profiles").select("display_currency").eq("id", user.id).single();

  const displayCurrency = (profile?.display_currency ?? "PLN") as "PLN" | "USD" | "EUR";

  try {
    const snapshot = await saveSnapshot(db, user.id, displayCurrency);
    return new Response(JSON.stringify({ data: snapshot }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save snapshot";
    return new Response(JSON.stringify({ error: { code: "SNAPSHOT_ERROR", message } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
