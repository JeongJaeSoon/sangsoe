import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// R-21 (decision 268): sangsoe does not permanently delete a file it did not just make. Notes live
// outside sangsoe (D-2), so the rule it can keep is about its own code: what it clears goes to the
// trash (core/reaper/resources.ts), and every permanent delete left in shipped code is listed here
// with the reason it removes only sangsoe's own short-lived file. A new delete fails this test until
// it is either moved to the trash or added with its reason.
const ROOT = new URL("..", import.meta.url).pathname;
const SHIPPED = ["core", "cli", "orca-plugin", "claude-plugin"];
const SKIP = new Set(["node_modules", "vendor", "dist"]);

const OWN_FILES: Readonly<Record<string, { calls: number; why: string }>> = {
  "core/approve/content-hash.ts": { calls: 1, why: "the mkdtemp copy it hashed" },
  "core/approve/ports.ts": { calls: 1, why: "the mkdtemp folder the release tarball was unpacked into" },
  "core/install/doctor.ts": { calls: 1, why: "the mkdtemp folder the release tarball was unpacked into" },
  "core/install/permissions.ts": { calls: 1, why: "sangsoe's record of the rules it added, or a settings file it created and emptied again" },
  "core/install/stage.ts": { calls: 2, why: "orca-plugin/vendor, the staged copy of core it builds" },
};

// A call of a node:fs delete, or a shell `rm` handed to an exec.
const DELETE = /\b(?:rmSync|unlinkSync|rmdirSync|rm|unlink|rmdir)\s*\(|exec\w*\(\s*["'`]rm["'`]/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|js|mjs|sh)$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

test("R-21: every permanent delete in shipped code is a listed one of sangsoe's own short-lived files", () => {
  const found: Record<string, number> = {};
  for (const f of SHIPPED.flatMap((d) => sources(join(ROOT, d)))) {
    const n = readFileSync(f, "utf8").match(DELETE)?.length ?? 0;
    if (n > 0) found[relative(ROOT, f)] = n;
  }
  assert.deepEqual(found, Object.fromEntries(Object.entries(OWN_FILES).map(([f, v]) => [f, v.calls])));
  for (const [f, v] of Object.entries(OWN_FILES)) assert.ok(v.why.length > 10, `${f}: say why`);
});

test("R-21: what REAPER clears from the temp folder goes to the trash, and without the trash command nothing is touched", () => {
  const src = readFileSync(join(ROOT, "core/reaper/resources.ts"), "utf8");
  assert.match(src, /export const TRASH_BIN = "\/usr\/bin\/trash";/);
  assert.match(src, /if \(a\.tmp && d\.trashBin\)/);
});
