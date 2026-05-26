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

  const { data: assets, error } = await db
    .from("assets")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_ERROR", message: "Failed to fetch assets", context: error } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ data: assets }), {
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

  if (!name || typeof name !== "string" || !name.trim()) {
    return new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "name is required" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (typeof amount !== "number" || isNaN(amount)) {
    return new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "amount must be a number" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!["PLN", "USD", "EUR"].includes(currency)) {
    return new Response(
      JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "currency must be PLN, USD, or EUR" } }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  if (!category || typeof category !== "string") {
    return new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "category is required" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: asset, error } = await db
    .from("assets")
    .insert({
      user_id: user.id,
      name: name.trim(),
      amount: amount,
      currency: currency as string,
      category: category,
      is_liability: Boolean(is_liability),
    })
    .select()
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "INSERT_ERROR", message: "Failed to create asset", context: error } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ data: asset }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};
