// Decision 77 다: `orca plugin enable` is called from `sangsoe plugin approve` and nowhere else.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".git", "dist", "docs"]);
const CODE = /\.(c|m)?(ts|js)x?$|\.(sh|py|json)$/;
const ALLOWED = new Set(["core/approve/approve.ts"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Either the words in one string or as separate array items: "plugin enable", "plugin", "enable".
const ENABLE = /plugin\s+enable|["'`]plugin["'`]\s*,\s*["'`]enable["'`]/;

test("no code path calls orca plugin enable except sangsoe plugin approve", () => {
  const hits = walk(ROOT)
    .filter((f) => CODE.test(f) && !f.endsWith(".test.ts"))
    .map((f) => relative(ROOT, f))
    .filter((f) => ENABLE.test(readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(
    hits.filter((f) => !ALLOWED.has(f)),
    [],
  );
  assert.ok(hits.includes("core/approve/approve.ts"), "the approve path itself should still call it");
});
