import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// Decision 94 (가), owner d125: core/start/ is the only code that opens a session. This walks every
// code file and finds the other ways in: a fallback start, a worktree created with a prompt or an
// agent, a `claude` process started directly, and worker-start called from outside core/start/.
// docs/ and this file are prose about the rule, not code paths.

const ROOT = new URL("../..", import.meta.url).pathname;
const SELF = relative(ROOT, new URL(import.meta.url).pathname);
const SKIP = new Set(["node_modules", ".git", "dist", "docs"]);
const CODE = /\.(c|m)?(ts|js)x?$|\.sh$|\.py$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const RAW_STARTS: [string, RegExp][] = [
  ["fallback start", /agent["'`,\s]+launch/],
  ["worktree create with a prompt or agent", /worktree["'`,\s]+create\b[^;)]{0,200}(--prompt|--agent|--spec)/],
  ["claude run directly", /(exec|spawn|execFile|execSync|spawnSync)\w*\(\s*["'`]claude["'`]\s*,\s*\[(?!\s*["'`]plugin["'`])/],
  ["claude run directly", /\bclaude\s+-p\b|nohup\s+claude\b/],
  ["unsupervised dispatch", /["'`]orchestration["'`]\s*,\s*["'`]dispatch["'`]|orchestration\s+dispatch(?![-\w])/],
];

// package.json scripts run too, so they are scanned as code.
const files = walk(ROOT)
  .map((f) => relative(ROOT, f))
  .filter((rel) => rel !== SELF && (CODE.test(rel) || rel === "package.json"))
  .map((rel) => ({ rel, text: readFileSync(join(ROOT, rel), "utf8") }));
const lines = files.flatMap(({ rel, text }) => text.split("\n").map((line, i) => ({ rel, n: i + 1, text: line })));

/** A call split over several lines matches once its whitespace is collapsed. */
const flat = (text: string) => text.replace(/\s+/g, " ");
const rawStarts = (text: string) => RAW_STARTS.filter(([, re]) => re.test(text)).map(([what]) => what);

test("no code opens a session outside the core start function", () => {
  const hits = lines.flatMap(({ rel, n, text }) => rawStarts(text).map((what) => `${rel}:${n} (${what}): ${text.trim()}`));
  const lineHit = new Set(hits.map((h) => h.split(":")[0]));
  for (const { rel, text } of files) {
    if (!lineHit.has(rel)) hits.push(...rawStarts(flat(text)).map((what) => `${rel} (${what}, across lines)`));
  }
  assert.deepEqual(hits, []);
});

test("worker-start is called only from core/start/", () => {
  const callers = lines
    .filter(({ text }) => /\.workerStart\(/.test(text))
    .map(({ rel }) => rel)
    .filter((rel) => !rel.startsWith("core/start/") && !rel.startsWith("test/"));
  assert.deepEqual([...new Set(callers)], []);
});

test("the patterns catch what they are meant to", () => {
  const bad = [
    `await exec("orca", ["agent", "launch", "--agent", "claude"])`,
    `run("orca worktree create --name x --agent claude")`,
    `spawn("claude", ["-p", "do it"])`,
    `sh("nohup claude -p task &")`,
    `exec("orca", ["orchestration", "dispatch", "--task", id])`,
  ];
  for (const b of bad) assert.ok(RAW_STARTS.some(([, re]) => re.test(b)), b);
  const multiline = `execFile(\n  "orca",\n  ["worktree", "create",\n   "--agent", "claude"],\n)`;
  assert.ok(rawStarts(flat(multiline)).length > 0, "a call split over lines");
  assert.ok(rawStarts(flat(`spawn(\n  "claude",\n  ["-p", x],\n)`)).length > 0);
  const fine = [`exec("claude", ["plugin", "list", "--json"])`, `orca.workerStart({ task, worktree: "new-child" })`];
  for (const f of fine) assert.ok(!RAW_STARTS.some(([, re]) => re.test(f)), f);
});
