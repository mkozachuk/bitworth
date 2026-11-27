import type { APIRoute } from "astro";
import { getRates } from "@/lib/exchange-rates";

// Rates are intentionally unauthenticated — exchange rates are public financial data
// with no user-specific sensitivity. This is an explicit design decision, not an oversight.
export const GET: APIRoute = async () => {
  const { rates, approximate } = await getRates();
  return new Response(JSON.stringify({ rates, approximate }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
};
