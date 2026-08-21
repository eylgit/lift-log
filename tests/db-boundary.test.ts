/**
 * C2.3 — only `src/db/` knows which database is underneath.
 *
 * The exit criterion for Part C is that `grep -r dexie src/ --exclude-dir=db`
 * comes back empty. This is that grep, run by CI, with a reason attached to
 * each rule so a failure explains itself.
 *
 * Why it is worth a test rather than a habit: the cost of a stray Dexie import
 * in a screen is invisible until the day the app is wrapped for iOS (Part J)
 * and the storage layer is swapped for SQLite. At that point the difference
 * between "one folder to rewrite" and "grep the whole app" is the difference
 * between a day and a fortnight. Nothing enforces the boundary except this.
 *
 * It lives outside `src/` because it reads the filesystem — the same reason
 * `engine-purity.test.ts` does.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const DB_DIR = join(SRC, "db");

/** What the layer above storage may not know about, and why. */
const FORBIDDEN = [
  {
    pattern: /(?:from|import)\s*\(?\s*["']dexie(?:\/[^"']*)?["']/,
    what: "imports dexie",
    reason: "Storage is an adapter. Screens hold a Repo and never name the database (§8.1).",
  },
  {
    pattern: /\bindexedDB\b/,
    what: "reaches for indexedDB",
    reason: "IndexedDB is a browser API. The native build has no such thing (Part J).",
  },
];

/** Strip comments so a module named in prose does not fail the build. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path === DB_DIR ? [] : sourceFiles(path);
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) return [];
    return [path];
  });
}

describe("nothing outside src/db/ knows about the database", () => {
  const files = sourceFiles(SRC).map((f) => [relative(SRC, f).split(sep).join("/"), f] as const);

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  describe.each(files)("src/%s", (_label, file) => {
    const code = stripComments(readFileSync(file, "utf8"));

    it.each(FORBIDDEN)("never $what — $reason", ({ pattern }) => {
      expect(code).not.toMatch(pattern);
    });
  });
});

describe("the interface is free of its implementation", () => {
  const code = stripComments(readFileSync(join(DB_DIR, "repo.ts"), "utf8"));

  it.each(FORBIDDEN)("never $what — $reason", ({ pattern }) => {
    expect(code).not.toMatch(pattern);
  });

  it("does not import the schema either", () => {
    // `schema.ts` imports Dexie, so importing it here would reintroduce the
    // dependency the interface exists to remove — even though the types
    // themselves are erased at compile time. Shared storage types live in
    // `src/db/types.ts` for exactly this reason.
    expect(code).not.toMatch(/from\s+["']\.\/schema["']/);
  });
});
