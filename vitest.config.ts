import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// `astro:env/server` is a virtual module provided by Astro's vite plugin, which
// vitest doesn't load. Stub it so modules that read server env (supabase,
// crypto-prices, …) resolve under test, sourcing values from process.env.
function astroEnvServerStub() {
  const virtualId = "astro:env/server";
  const resolvedId = "\0astro:env/server";
  return {
    name: "astro-env-server-stub",
    resolveId(id: string) {
      if (id === virtualId) return resolvedId;
    },
    load(id: string) {
      if (id === resolvedId) {
        return [
          "export const SUPABASE_URL = process.env.SUPABASE_URL;",
          "export const SUPABASE_KEY = process.env.SUPABASE_KEY;",
          "export const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;",
          "export const METALS_API_KEY = process.env.METALS_API_KEY;",
        ].join("\n");
      }
    },
  };
}

export default defineConfig({
  plugins: [tsconfigPaths(), astroEnvServerStub()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
