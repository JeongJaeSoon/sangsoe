import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const SLOT_ROOTS = ["core", "cli", "orca-plugin", "claude-plugin"];
const SKIP = new Set(["node_modules", ".git", "dist"]);
// layer "-" / tokens "mixed" are for a slot root whose subdirectories carry the real labels.
const LABEL = /^<!-- layout: slot=(①|②|③|④) layer=(감지|실행|판단|-) tokens=(free|using|mixed) -->$/;
const CODE_EXT = /\.(ts|js|mjs|cjs|sh|py)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const rel = (p: string) => relative(ROOT, p);
const files = walk(ROOT);
const homes = files
  .filter((f) => f.endsWith("/README.md") && SLOT_ROOTS.some((s) => rel(f).startsWith(`${s}/`)))
  .map((f) => {
    const dir = rel(f).replace(/\/README\.md$/, "");
    const first = readFileSync(f, "utf8").split("\n", 1)[0] ?? "";
    return { dir, label: LABEL.exec(first) };
  });

test("every slot root has a labelled README", () => {
  for (const s of SLOT_ROOTS) assert.ok(homes.some((h) => h.dir === s), `${s}/README.md missing`);
});

test("every home README starts with a slot/layer/tokens label", () => {
  for (const h of homes) assert.ok(h.label, `${h.dir}/README.md: first line is not a layout label`);
});

test("only slot roots may be mixed", () => {
  for (const h of homes.filter((x) => x.label?.[2] === "-" || x.label?.[3] === "mixed")) {
    assert.ok(SLOT_ROOTS.includes(h.dir), `${h.dir}/ must pick one layer and one token side`);
  }
});

test("docs/architecture.md maps every labelled home", () => {
  const arch = readFileSync(join(ROOT, "docs/architecture.md"), "utf8");
  for (const h of homes) assert.ok(arch.includes(`\`${h.dir}/\``), `${h.dir}/ is not in docs/architecture.md`);
});

test("token-using homes hold no code", () => {
  for (const h of homes.filter((x) => x.label?.[3] === "using")) {
    const code = files.filter((f) => rel(f).startsWith(`${h.dir}/`) && CODE_EXT.test(f));
    assert.deepEqual(code.map(rel), [], `${h.dir}/ is token-using but holds code`);
  }
});

test("other slots import the core only through core/index.ts", () => {
  const importRe = /from\s+["']([^"']*core\/[^"']*)["']/g;
  for (const f of files.filter((x) => x.endsWith(".ts") && !rel(x).startsWith("core/"))) {
    for (const m of readFileSync(f, "utf8").matchAll(importRe)) {
      assert.match(m[1] ?? "", /core\/index\.ts$/, `${rel(f)} imports core internals: ${m[1]}`);
    }
  }
});

test("no property-list job definitions in the tree", () => {
  assert.deepEqual(files.filter((f) => f.endsWith(".plist")).map(rel), []);
});
