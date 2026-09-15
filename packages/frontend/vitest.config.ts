import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests cover the pure client-side logic (amount maths, milestone
 * scheduling, API parsing and transaction building). Wallet and RPC calls are
 * faked, so the suite needs neither a browser nor a network.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: { NODE_ENV: "test" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
