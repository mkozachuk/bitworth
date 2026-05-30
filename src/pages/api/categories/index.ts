import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

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

  const { data, error } = await supabase
    .from("asset_categories")
    .select("*")
    .order("is_liability", { ascending: true })
    .order("display_order", { ascending: true });

  if (error) {
    return new Response(
      JSON.stringify({ error: { code: "FETCH_FAILED", message: error.message } } satisfies ErrorShape),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
