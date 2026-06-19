import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

interface ErrorShape {
  error: { code: string; message: string; context?: unknown };
}

export const GET: APIRoute = async ({ request, cookies }) => {
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

  const { data, error } = await supabase
    .from("assets")
    .select("*, category:asset_categories(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_FAILED", message: error.message } } satisfies ErrorShape),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(
    JSON.stringify({ data: data as (Tables<"assets"> & { category: Tables<"asset_categories"> })[] }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};

export const POST: APIRoute = async ({ request, cookies }) => {
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

  const form = await request.formData();
  const name = form.get("name") as string | null;
  const amount = form.get("amount") as string | null;
  const currency = form.get("currency") as string | null;
  const category_id = form.get("category_id") as string | null;
  const notes = form.get("notes") as string | null;
  const crypto_symbol = form.get("crypto_symbol") as string | null;
  const quantity = form.get("quantity") as string | null;
  const show_on_chart = form.get("show_on_chart");

  if (!name || !amount || !currency || !category_id) {
    return new Response(
      JSON.stringify({
        error: { code: "VALIDATION_ERROR", message: "name, amount, currency, and category_id are required" },
      } satisfies ErrorShape),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum)) {
    return new Response(
      JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "amount must be a number" } } satisfies ErrorShape),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { data, error } = await supabase
    .from("assets")
    .insert({
      name,
      amount: amountNum,
      currency,
      category_id,
      notes: notes !== "" ? notes : null,
      crypto_symbol: crypto_symbol !== "" ? crypto_symbol : null,
      quantity: quantity !== "" && quantity !== null ? parseFloat(quantity) : null,
      show_on_chart: show_on_chart === "true",
      user_id: user.id,
    })
    .select()
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "INSERT_FAILED", message: error.message } } satisfies ErrorShape),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(JSON.stringify({ data: data as Tables<"assets"> }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};
