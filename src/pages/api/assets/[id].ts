import type { APIRoute } from "astro";
import { createDbClient } from "@/lib/db";

export const PUT: APIRoute = async ({ request, cookies, params }) => {
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

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: { code: "MISSING_ID", message: "Asset ID is required" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify ownership
  const { data: existing } = await db.from("assets").select("id").eq("id", id).eq("user_id", user.id).single();
  if (!existing) {
    return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Asset not found" } }), {
      status: 404,
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

  const { name, amount, currency, category, is_liability } = body as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return new Response(
        JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "name must be a non-empty string" } }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    updates.name = name.trim();
  }
  if (amount !== undefined) {
    if (typeof amount !== "number" || isNaN(amount)) {
      return new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "amount must be a number" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    updates.amount = amount;
  }
  if (currency !== undefined) {
    if (!["PLN", "USD", "EUR"].includes(currency)) {
      return new Response(
        JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "currency must be PLN, USD, or EUR" } }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    updates.currency = currency;
  }
  if (category !== undefined) {
    if (typeof category !== "string") {
      return new Response(
        JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "category must be a string" } }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    updates.category = category;
  }
  if (is_liability !== undefined) {
    updates.is_liability = Boolean(is_liability);
  }

  const { data: asset, error } = await db.from("assets").update(updates).eq("id", id).select().single();

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "UPDATE_ERROR", message: "Failed to update asset", context: error } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ data: asset }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const DELETE: APIRoute = async ({ request, cookies, params }) => {
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

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: { code: "MISSING_ID", message: "Asset ID is required" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error } = await db.from("assets").delete().eq("id", id).eq("user_id", user.id);

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "DELETE_ERROR", message: "Failed to delete asset", context: error } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(null, { status: 204 });
};
