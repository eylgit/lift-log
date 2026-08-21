import { defineConfig } from "vitest/config";

// The engine is pure TypeScript, so the tests need no browser and no plugins.
// This config deliberately does not load vite.config.ts — the PWA plugin has
// nothing to do with testing and only slows the run down.
//
// `fake-indexeddb/auto` installs an in-memory IndexedDB onto the global object,
// which is the one thing a Node environment is missing that `src/db/` needs
// (C1). It is the real IndexedDB algorithm, not a stub, so a schema that opens
// here opens in a browser.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["fake-indexeddb/auto"],
  },
});
