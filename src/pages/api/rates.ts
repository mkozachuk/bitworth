import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getRates } from "@/lib/exchange-rates";

// Rates are intentionally unauthenticated — exchange rates are public financial data
// with no user-specific sensitivity. This is an explicit design decision, not an oversight.
export const GET: APIRoute = async ({ request, cookies }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ rates: { USD: 1.0, EUR: 0.92, PLN: 3.85 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rates = await getRates(supabase);
  return new Response(JSON.stringify({ rates }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
