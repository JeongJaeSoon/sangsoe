// Decision 77: `orca plugin enable` is called from `sangsoe plugin approve` and nowhere else.
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
// `claude plugin enable` (Claude Code's own plugin: a doctor fix hint, or install's run of
// `claude` with its argv written right after the command name) is a different gate.
const ENABLE = /(?<!claude\s+)plugin\s+enable|(?<!["'`]claude["'`]\s*,\s*\[\s*)["'`]plugin["'`]\s*,\s*["'`]enable["'`]/;

test("the guard tells Orca's enable from Claude Code's", () => {
  assert.ok(ENABLE.test("orca plugin enable local.sangsoe"));
  assert.ok(ENABLE.test('["orca", "plugin", "enable"]'));
  assert.ok(ENABLE.test('host.run("orca", ["plugin", "enable", key])'));
  assert.ok(ENABLE.test("run(`plugin  enable local.sangsoe`)"));
  assert.ok(!ENABLE.test("fix: `claude plugin enable sangsoe@sangsoe`"));
  assert.ok(!ENABLE.test('host.run("claude", ["plugin", "enable", PLUGIN_ID, "--scope", "user"], env)'));
});

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
