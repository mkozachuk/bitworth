import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getPrice } from "@/lib/crypto-prices";

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

  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  if (!symbol) {
    return new Response(
      JSON.stringify({
        error: { code: "MISSING_SYMBOL", message: "symbol query parameter is required" },
      } satisfies ErrorShape),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const result = await getPrice(supabase, symbol);
  if ("error" in result) {
    const isNotFound = result.error.code === "COIN_NOT_FOUND" || result.error.code === "PRICE_UNAVAILABLE";
    return new Response(JSON.stringify({ error: result.error } satisfies ErrorShape), {
      status: isNotFound ? 404 : 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
