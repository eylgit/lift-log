/**
 * B1.3 — the engine stays pure, and the build says so.
 *
 * src/engine/ answers "what should I lift today" from a history. It is called
 * by the shell; it never calls back out. That means no React, no storage, and
 * no browser globals. The point is not that such an import breaks anything
 * today — it is that it would quietly cost us the ability to test the engine
 * without a browser, and we would not notice until the tests were already too
 * painful to write.
 *
 * This test lives outside src/engine/ on purpose: it reads the filesystem,
 * which is exactly the kind of thing the engine may not do.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ENGINE_DIR = join(process.cwd(), "src", "engine");

/** Modules the engine may not depend on, and why. */
const FORBIDDEN_IMPORTS = [
  { module: "react", reason: "React is the shell. The engine must run without a screen." },
  { module: "react-dom", reason: "React is the shell. The engine must run without a screen." },
  { module: "dexie", reason: "Storage is an adapter (C2). History is passed in, not fetched." },
];

/** Globals that only exist in a browser. */
const FORBIDDEN_GLOBALS = [
  { name: "window", reason: "A browser global. The engine also runs in tests and, later, natively." },
  { name: "document", reason: "A browser global. The engine draws nothing." },
  { name: "localStorage", reason: "Storage is an adapter (C2)." },
  { name: "indexedDB", reason: "Storage is an adapter (C2)." },
];

function engineSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return engineSourceFiles(path);
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) return [];
    return [path];
  });
}

/** Strip comments so a module named in prose does not fail the build. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("the engine is pure", () => {
  const files = engineSourceFiles(ENGINE_DIR);

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  describe.each(files.map((f) => [f.slice(process.cwd().length + 1), f] as const))(
    "%s",
    (_label, file) => {
      const code = stripComments(readFileSync(file, "utf8"));

      it.each(FORBIDDEN_IMPORTS)("does not import $module — $reason", ({ module }) => {
        const importPattern = new RegExp(
          `(?:from|import)\\s*\\(?\\s*["']${module}(?:/[^"']*)?["']`,
        );
        expect(code).not.toMatch(importPattern);
      });

      it.each(FORBIDDEN_GLOBALS)("does not reference $name — $reason", ({ name }) => {
        expect(code).not.toMatch(new RegExp(`\\b${name}\\b`));
      });
    },
  );
});
