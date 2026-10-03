import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// `npm run test:db`: migrations, restore_backup and RLS on real Postgres
// (PGlite, in-process WASM). Kept out of `test:ci` so the unit suite's time is
// unchanged; CI runs it as its own step.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/test/db/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
