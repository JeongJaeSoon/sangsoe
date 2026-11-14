import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { diskHash } from "../../test/dir-hash.ts";
import { scratchDir } from "../../test/scratch.ts";
import { inspectContentHash } from "./content-hash.ts";

function pluginFolder(): string {
  const dir = join(scratchDir("sangsoe-u128-"), "orca-plugin");
  mkdirSync(join(dir, "panel"), { recursive: true });
  writeFileSync(join(dir, "orca-plugin.json"), '{"id":"sangsoe"}');
  writeFileSync(join(dir, "panel", "view.ts"), "export {};");
  return dir;
}

// What `orca plugin dev load` and `orca plugin types` write into the folder.
function orcaWrites(dir: string): void {
  mkdirSync(join(dir, ".orca", "types", "orca"), { recursive: true });
  writeFileSync(join(dir, ".orca", ".gitignore"), "*");
  writeFileSync(join(dir, ".orca", "types", "orca", "index.d.ts"), "declare const orca: unknown;");
}

function recordingInspect() {
  const seen: string[] = [];
  const inspect = async (d: string) => {
    seen.push(d);
    return diskHash(d);
  };
  return { seen, inspect };
}

test("a folder Orca wrote .orca/ into hashes as the same folder without it", async () => {
  const dir = pluginFolder();
  const before = diskHash(dir);
  orcaWrites(dir);
  assert.notEqual(diskHash(dir), before, "the stand-in counts .orca/, as Orca's inspect does");
  const { seen, inspect } = recordingInspect();
  assert.equal(await inspectContentHash(dir, inspect), before);
  assert.equal(seen.length, 1);
  assert.notEqual(seen[0], dir, "inspected a copy, not the folder");
  assert.equal(existsSync(seen[0] ?? ""), false, "the copy is removed");
  assert.ok(existsSync(join(dir, ".orca", ".gitignore")), "the folder itself is untouched");
});

test("a folder without .orca/ is inspected where it is", async () => {
  const dir = pluginFolder();
  const { seen, inspect } = recordingInspect();
  assert.equal(await inspectContentHash(dir, inspect), diskHash(dir));
  assert.deepEqual(seen, [dir]);
});

test("a .orca that is a file or a symlink is not Orca's folder and still counts", async () => {
  const file = pluginFolder();
  writeFileSync(join(file, ".orca"), "not a folder");
  const link = pluginFolder();
  const elsewhere = scratchDir("sangsoe-u128-");
  symlinkSync(elsewhere, join(link, ".orca"));
  for (const dir of [file, link]) {
    const { seen, inspect } = recordingInspect();
    await inspectContentHash(dir, inspect);
    assert.deepEqual(seen, [dir]);
  }
});

test("a nested .orca/ is plugin content and still counts", async () => {
  const dir = pluginFolder();
  const clean = diskHash(dir);
  mkdirSync(join(dir, "panel", ".orca"));
  writeFileSync(join(dir, "panel", ".orca", "x.ts"), "export {};");
  const withNested = diskHash(dir);
  orcaWrites(dir);
  const { inspect } = recordingInspect();
  const h = await inspectContentHash(dir, inspect);
  assert.notEqual(h, clean);
  assert.equal(h, withNested);
});

// Review round 1: a folder path that is itself a relative link must hash the bytes Orca runs.
test("a folder reached through a relative link is hashed where the link leads, not where a copy of the link would", async () => {
  const root = scratchDir("sangsoe-u128-");
  const real = join(root, "real", "orca-plugin");
  mkdirSync(real, { recursive: true });
  writeFileSync(join(real, "orca-plugin.json"), '{"id":"sangsoe"}');
  writeFileSync(join(real, "main.ts"), "export const edited = 1;");
  orcaWrites(real);
  mkdirSync(join(root, "via"));
  symlinkSync("../real/orca-plugin", join(root, "via", "orca-plugin"));
  const realWithout = join(scratchDir("sangsoe-u128-"), "orca-plugin");
  mkdirSync(realWithout);
  writeFileSync(join(realWithout, "orca-plugin.json"), '{"id":"sangsoe"}');
  writeFileSync(join(realWithout, "main.ts"), "export const edited = 1;");
  const { inspect } = recordingInspect();
  assert.equal(await inspectContentHash(join(root, "via", "orca-plugin"), inspect), diskHash(realWithout));
});

test("a link inside a folder that needs a copy cannot be hashed, so the comparison fails closed", async () => {
  const dir = pluginFolder();
  orcaWrites(dir);
  symlinkSync("../elsewhere/main.ts", join(dir, "panel", "linked.ts"));
  const { seen, inspect } = recordingInspect();
  assert.equal(await inspectContentHash(dir, inspect), null);
  assert.deepEqual(seen, [], "nothing was inspected");
});

test("a folder that cannot be copied cannot be hashed", async (t) => {
  if (process.getuid?.() === 0) return t.skip("root reads any file");
  const dir = pluginFolder();
  orcaWrites(dir);
  const locked = join(dir, "panel", "view.ts");
  chmodSync(locked, 0o000);
  t.after(() => chmodSync(locked, 0o644));
  const { seen, inspect } = recordingInspect();
  assert.equal(await inspectContentHash(dir, inspect), null);
  assert.deepEqual(seen, []);
});

// Decision 258 ③: leaving .orca/ out is safe only while no plugin code loads anything from it.
test("no plugin source loads anything from .orca/", () => {
  const plugin = new URL("../../orca-plugin/", import.meta.url).pathname;
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "vendor" && e.name !== ".orca" && e.name !== "node_modules") walk(p);
      } else if (/\.(m?[jt]sx?|json)$/.test(e.name) && readFileSync(p, "utf8").includes(".orca/")) hits.push(p);
    }
  };
  walk(plugin);
  assert.deepEqual(hits, []);
});

test("the copy is removed when inspect fails or throws", async () => {
  const dir = pluginFolder();
  orcaWrites(dir);
  const seen: string[] = [];
  assert.equal(
    await inspectContentHash(dir, async (d) => {
      seen.push(d);
      return null;
    }),
    null,
  );
  await assert.rejects(
    inspectContentHash(dir, async (d) => {
      seen.push(d);
      throw new Error("orca gone");
    }),
  );
  assert.equal(seen.length, 2);
  for (const d of seen) assert.equal(existsSync(d), false, d);
});
