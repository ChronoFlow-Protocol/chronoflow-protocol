import { defineConfig } from "vitest/config";

/**
 * Tests run against a throwaway SQLite file that is recreated on every run
 * (see test/global-setup.ts), never against the development database.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: "file:./test.db",
    },
    // The suite shares one SQLite file, so keep it single-threaded.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
