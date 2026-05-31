import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

export const PUT: APIRoute = async ({ params, request, cookies }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } } satisfies ErrorShape),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } } satisfies ErrorShape),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const id = params.id;
  if (!id) {
    return new Response(
      JSON.stringify({ error: { code: "MISSING_ID", message: "Asset ID is required" } } satisfies ErrorShape),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const form = await request.formData();
  const name = form.get("name") as string | null;
  const amount = form.get("amount") as string | null;
  const currency = form.get("currency") as string | null;
  const category_id = form.get("category_id") as string | null;
  const notes = form.get("notes") as string | null;
  const crypto_symbol = form.get("crypto_symbol") as string | null;

  const updates: Record<string, unknown> = {};
  if (name !== null) updates.name = name;
  if (amount !== null) {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) {
      return new Response(
        JSON.stringify({
          error: { code: "VALIDATION_ERROR", message: "amount must be a number" },
        } satisfies ErrorShape),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    updates.amount = amountNum;
  }
  if (currency !== null) updates.currency = currency;
  if (category_id !== null) updates.category_id = category_id;
  if (notes !== null) updates.notes = notes !== "" ? notes : null;
  if (crypto_symbol !== null) updates.crypto_symbol = crypto_symbol !== "" ? crypto_symbol : null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { data, error } = await supabase
    .from("assets")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "UPDATE_FAILED", message: error.message } } satisfies ErrorShape),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!data) {
    return new Response(
      JSON.stringify({ error: { code: "NOT_FOUND", message: "Asset not found" } } satisfies ErrorShape),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(JSON.stringify({ data: data as Tables<"assets"> }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } } satisfies ErrorShape),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } } satisfies ErrorShape),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const id = params.id;
  if (!id) {
    return new Response(
      JSON.stringify({ error: { code: "MISSING_ID", message: "Asset ID is required" } } satisfies ErrorShape),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const { data, error } = await supabase.from("assets").delete().eq("id", id).eq("user_id", user.id).select().single();

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "DELETE_FAILED", message: error.message } } satisfies ErrorShape),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!data) {
    return new Response(
      JSON.stringify({ error: { code: "NOT_FOUND", message: "Asset not found" } } satisfies ErrorShape),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(JSON.stringify({ data: data as Tables<"assets"> }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
