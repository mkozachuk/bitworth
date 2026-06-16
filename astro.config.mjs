// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";
import pwa from "./src/integrations/pwa";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap(), pwa()],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      COINGECKO_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
