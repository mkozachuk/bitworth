import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

export function createDbClient(_requestHeaders: Headers, _cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(_requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          _cookies.set(name, value, options);
        });
      },
    },
  });
}

/**
 * Admin client using the service role key — bypasses RLS.
 * Use only on the server side and only for public data (exchange rates)
 * or demo data that has no sensitive content.
 */
export function createSupabaseAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_KEY);
}
