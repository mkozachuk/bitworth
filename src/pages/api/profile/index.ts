import type { APIRoute } from "astro";
import { createDbClient } from "@/lib/db";

export const PUT: APIRoute = async ({ request, cookies }) => {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: { code: "INVALID_BODY", message: "Invalid JSON body" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { display_currency } = body as Record<string, unknown>;

  if (!display_currency || !["PLN", "USD", "EUR"].includes(display_currency as string)) {
    return new Response(
      JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "display_currency must be PLN, USD, or EUR" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { data: profile, error } = await db
    .from("profiles")
    .update({ display_currency: display_currency as string })
    .eq("id", user.id)
    .select()
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "UPDATE_ERROR", message: "Failed to update profile", context: error } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ data: profile }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
