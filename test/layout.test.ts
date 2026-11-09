import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const SLOT_ROOTS = ["core", "cli", "orca-plugin", "claude-plugin"];
const SKIP = new Set(["node_modules", ".git", "dist"]);
// layer "-" / tokens "mixed" are for a slot root whose subdirectories carry the real labels.
const LABEL = /^<!-- layout: slot=(①|②|③|④) layer=(감지|실행|판단|-) tokens=(free|using|mixed) -->$/;
const CODE_EXT = /\.(c|m)?(ts|js)x?$|\.(sh|py)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const rel = (p: string) => relative(ROOT, p);
const files = walk(ROOT);
const read = (f: string) => readFileSync(f, "utf8");
const under = (dir: string) => files.filter((f) => rel(f).startsWith(`${dir}/`));
const isCode = (f: string) =>
  CODE_EXT.test(f) || (!/\.[^/]+$/.test(rel(f)) && read(f).startsWith("#!"));

type Label = { slot: string; layer: string; tokens: string };
const fmt = (l: Label) => `slot=${l.slot} layer=${l.layer} tokens=${l.tokens}`;

// Claude Code loads every .md in claude-plugin/agents/ as an agent, so that folder carries its label in a
// `.layout` file holding the same line instead of a README.
const AGENTS = "claude-plugin/agents";
const MARKER = /\/(README\.md|\.layout)$/;
const labelled = new Map<string, Label | null>(
  files
    .filter((f) => MARKER.test(f) && SLOT_ROOTS.some((s) => rel(f).startsWith(`${s}/`)))
    .map((f) => {
      const m = LABEL.exec(read(f).split("\n", 1)[0] ?? "");
      const dir = rel(f).replace(MARKER, "");
      return [dir, m ? { slot: m[1] ?? "", layer: m[2] ?? "", tokens: m[3] ?? "" } : null];
    }),
);

test("only claude-plugin/agents/ uses a .layout marker, and it holds agent definitions only", () => {
  const markers = files.filter((f) => f.endsWith("/.layout")).map(rel);
  assert.deepEqual(markers, [`${AGENTS}/.layout`]);
  for (const f of under(AGENTS).filter((x) => x.endsWith(".md"))) {
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(read(f));
    assert.ok(m, `${rel(f)} has no closed frontmatter, so it is not an agent definition`);
    const [, head = "", body = ""] = m;
    for (const key of ["name", "description"]) {
      assert.match(head, new RegExp(`^${key}:[ \\t]*\\S`, "m"), `${rel(f)} frontmatter has no ${key}`);
    }
    assert.ok(body.trim(), `${rel(f)} has no prompt body`);
  }
});

// docs/architecture.md's table is the one list of homes; READMEs must agree with it both ways.
const TOKENS: Record<string, string> = { X: "free", O: "using", 섞임: "mixed" };
const ROW = /^\| (감지|실행|판단|—) \| \x60([^\x60]+)\/\x60 \| (X|O|섞임) \| (①|②|③|④)/gm;
const mapped = new Map<string, Label>();
for (const m of read(join(ROOT, "docs/architecture.md")).matchAll(ROW)) {
  const layer = m[1] === "—" ? "-" : (m[1] ?? "");
  mapped.set(m[2] ?? "", { slot: m[4] ?? "", layer, tokens: TOKENS[m[3] ?? ""] ?? "" });
}

// Fixed by the design, not by the table: decision 78's slots and "only judgment spends tokens".
const ROOT_SLOT: Record<string, string> = { core: "④", cli: "④", "orca-plugin": "②", "claude-plugin": "③" };
const LAYER_TOKENS: Record<string, string> = { 감지: "free", 실행: "free", 판단: "using" };

test("docs/architecture.md maps every slot root to its decision-78 slot", () => {
  for (const s of SLOT_ROOTS) assert.equal(mapped.get(s)?.slot, ROOT_SLOT[s], `${s}/ slot in the architecture table`);
});

test("every home sits in its root's slot", () => {
  for (const [dir, l] of mapped) {
    const root = SLOT_ROOTS.find((s) => dir === s || dir.startsWith(`${s}/`));
    assert.ok(root, `${dir}/ is outside the slot roots`);
    assert.equal(l.slot, ROOT_SLOT[root], `${dir}/ slot`);
  }
});

test("the table covers all three layers, and only 판단 spends tokens", () => {
  const layers = new Set([...mapped.values()].map((l) => l.layer));
  for (const layer of Object.keys(LAYER_TOKENS)) assert.ok(layers.has(layer), `no home for layer ${layer}`);
  for (const [dir, l] of mapped) {
    if (l.layer in LAYER_TOKENS) assert.equal(l.tokens, LAYER_TOKENS[l.layer], `${dir}/ tokens for ${l.layer}`);
  }
});

test("every mapped home has a README whose label matches the table", () => {
  for (const [dir, want] of mapped) {
    assert.ok(labelled.has(dir), `${dir}/README.md missing`);
    const got = labelled.get(dir);
    assert.ok(got, `${dir}/README.md: first line is not a layout label`);
    assert.equal(fmt(got), fmt(want), `${dir}/ label disagrees with docs/architecture.md`);
  }
});

test("every labelled README is in the architecture table", () => {
  for (const dir of labelled.keys()) assert.ok(mapped.has(dir), `${dir}/ is not in docs/architecture.md`);
});

test("only slot roots may be mixed", () => {
  for (const [dir, l] of mapped) {
    if (l.layer === "-" || l.tokens === "mixed") assert.ok(SLOT_ROOTS.includes(dir), `${dir}/ must pick one side`);
  }
});

test("token-using homes hold no code", () => {
  for (const [dir, l] of mapped) {
    if (l.tokens !== "using") continue;
    assert.deepEqual(under(dir).filter(isCode).map(rel), [], `${dir}/ is token-using but holds code`);
  }
});

test("token-free homes hold no prompts", () => {
  for (const [dir, l] of mapped) {
    if (l.tokens !== "free") continue;
    const prompts = under(dir).filter((f) => f.endsWith(".md") && !f.endsWith("/README.md"));
    assert.deepEqual(prompts.map(rel), [], `${dir}/ is token-free but holds prompt files`);
  }
});

test("other slots reach the core only through core/index.ts", () => {
  const specRe = /["'`](\.{1,2}\/[^"'`]*?\bcore\/[^"'`]*)["'`]/g;
  for (const f of files.filter((x) => isCode(x) && !rel(x).startsWith("core/"))) {
    for (const m of read(f).matchAll(specRe)) {
      assert.match(m[1] ?? "", /(^|\/)core\/index\.(ts|js)$/, `${rel(f)} reaches core internals: ${m[1]}`);
    }
  }
});

test("no property-list job definitions in the tree", () => {
  assert.deepEqual(files.filter((f) => f.endsWith(".plist")).map(rel), []);
});
