import { defineConfig } from "vitest/config";

// The engine is pure TypeScript, so the tests need no browser and no plugins.
// This config deliberately does not load vite.config.ts — the PWA plugin has
// nothing to do with testing and only slows the run down.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
