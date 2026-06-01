import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import type { Database } from "./database.types";

// eslint-disable-next-line @typescript-eslint/no-deprecated
let browserClient: ReturnType<typeof createBrowserClient<Database, "public">> | null = null;

export function getSupabaseBrowserClient() {
  if (!browserClient && SUPABASE_URL && SUPABASE_KEY) {
    browserClient = createBrowserClient<Database, "public">(SUPABASE_URL, SUPABASE_KEY);
  }
  return browserClient;
}
