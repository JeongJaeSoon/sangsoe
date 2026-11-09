import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { type CommandSpec, ORCA_COMMANDS } from "../core/index.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const SELF = relative(ROOT, new URL(import.meta.url).pathname);
const SKIP = new Set(["node_modules", ".git", "dist", "docs"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Decision 60: a consuming mail read (or its --ack) hides mail from the agent it belongs to.
// Owner d125: no session starts outside the core start procedure, so no wrapper for the fallback start.
const FORBIDDEN = [/agent\s+launch/, /orchestration\s+check/, /["'`]check["'`]/, /--ack\b/];

test("no code path names a consuming mail read or the fallback start", () => {
  const hits: string[] = [];
  for (const f of walk(ROOT)) {
    const rel = relative(ROOT, f);
    if (rel === SELF || !/\.(c|m)?(ts|js)x?$|\.json$|\.sh$/.test(rel) || rel === "package-lock.json") continue;
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (FORBIDDEN.some((re) => re.test(line))) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});

test("the adapter's command table holds neither", () => {
  for (const spec of Object.values(ORCA_COMMANDS) as CommandSpec[]) {
    const name = spec.path.join(" ");
    assert.ok(!FORBIDDEN.some((re) => re.test(name)) && !spec.path.includes("check"), name);
    assert.ok(!spec.flags.includes("ack"), `${name} --ack`);
  }
});
