// Decisions 164-165: core/models/table.ts is the one model-selection table. This fails when a role or
// kind has no row, when a row points nowhere, when a second copy of the table (or a version number)
// appears anywhere else, and when an agent's frontmatter model or effort disagrees with the table.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import {
  MODEL_CATALOG as CATALOG,
  catalogAgeDays,
  EFFORTS,
  MODEL_KINDS as KINDS,
  MODEL_POLICY as POLICY,
  MODEL_SOURCES as SOURCES,
  MODEL_STALE_DAYS as STALE_DAYS,
  MODEL_TIERS as TIERS,
  modelTable,
  resolveModel as resolve,
  VERIFIED_WITH_CLAUDE_CODE,
} from "../core/index.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SKIP = new Set(["node_modules", ".git", "dist"]);
const HOME = "core/models/table.ts";
// The decision log quotes the guide with its version numbers; this file holds the patterns.
const EXEMPT = new Set([HOME, "docs/decisions.md", "test/model-table.test.ts", "package-lock.json"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(ROOT)
  .map((f) => relative(ROOT, f))
  .filter((rel) => !EXEMPT.has(rel) && /\.(ts|md|html|json|jsonl|svg)$/.test(rel));

const ROLES = [...(/export type Role = ([^;]+);/.exec(read("core/start/types.ts"))?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);

test("every role and kind has a policy row, and every row points at the catalog and a source", () => {
  assert.ok(ROLES.length >= 3, "Role union parsed");
  for (const role of ROLES) assert.ok((KINDS as readonly string[]).includes(role ?? ""), `role ${role} has no row`);
  assert.deepEqual(Object.keys(POLICY).sort(), [...KINDS].sort());
  for (const [kind, row] of Object.entries(POLICY)) {
    assert.ok(CATALOG.some((c) => c.tier === row.tier), `${kind}: tier ${row.tier} not in the catalog`);
    if (row.thenTier) assert.ok(CATALOG.some((c) => c.tier === row.thenTier), `${kind}: thenTier`);
    const ladder = [row.effort, ...row.raiseEffort].map((e) => EFFORTS.indexOf(e));
    assert.ok(ladder.every((v, i) => i === 0 || v > (ladder[i - 1] ?? -1)), `${kind}: effort ladder goes up`);
    assert.ok(row.cite in SOURCES && row.quote.length > 0 && row.trigger.length > 0, `${kind}: cite, quote, trigger`);
    // Policy names tiers only: no model name or version outside the verbatim quote.
    for (const text of [row.what, row.trigger]) assert.doesNotMatch(text, /\b(fable|opus|sonnet|haiku)\b|\d+\.\d+/i, `${kind}: ${text}`);
  }
});

test("the catalog has one row per tier, each with a source and a verified date", () => {
  assert.deepEqual(CATALOG.map((c) => c.tier).sort(), [...TIERS].sort());
  assert.equal(new Set(CATALOG.map((c) => c.alias)).size, CATALOG.length);
  for (const c of CATALOG) {
    assert.ok(c.source in SOURCES, c.tier);
    assert.match(c.verified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(c.verified)), c.verified);
  }
  assert.match(VERIFIED_WITH_CLAUDE_CODE, /^\d+\.\d+\.\d+$/);
});

const COPY_PATTERNS: [string, RegExp][] = [
  ["a dated model ID", /claude-(fable|opus|sonnet|haiku)-\d/],
  ["a model version", /\b(Fable|Opus|Sonnet|Haiku) \d/],
  ["a model-and-effort table row", /^\s*(\|.*|.*<td>.*)\b(fable|opus|sonnet|haiku)\b.*\b(low|medium|high|xhigh|max)\b/i],
  ["a model paired with an effort", /\b(fable|opus|sonnet|haiku)\b[^\n]{0,30}\b(low|medium|high|xhigh|max)\b/i],
  ["a role paired with a tier", /(\b(orchestrator|lead|worker)\b|(?<![가-힣])(오케스트레이터|리드|워커))[^\n]{0,40}\b(frontier|primary|everyday)\b(?! key)/],
];

test(`no second copy of the table: model versions, dated IDs and model/effort rows live only in ${HOME}`, () => {
  const hits: string[] = [];
  for (const rel of files) {
    read(rel)
      .split("\n")
      .forEach((line, i) => {
        for (const [what, re] of COPY_PATTERNS) if (re.test(line)) hits.push(`${rel}:${i + 1} (${what})`);
      });
  }
  assert.deepEqual(hits, []);
});

test("the copy patterns catch what they are meant to", () => {
  const bad = [
    "| deep | Opus / high | design |",
    "<tr><td>light</td><td>Haiku / low</td></tr>",
    '<text x="20">Opus · high — 설계</text>',
    '<text>리드</text><text class="m">primary</text>',
    "use claude-opus-5-5",
    "Sonnet 5 is",
  ];
  for (const b of bad) assert.ok(COPY_PATTERNS.some(([, re]) => re.test(b)), b);
  for (const fine of ["pass --model sonnet from a file", "resource `models` picks the model", "그리드 레이아웃의 primary 색"]) {
    assert.ok(!COPY_PATTERNS.some(([, re]) => re.test(fine)), fine);
  }
});

test("each agent's frontmatter model and effort are its role row's", () => {
  for (const name of readdirSync(join(ROOT, "claude-plugin/agents")).filter((n) => n.endsWith(".md"))) {
    const role = name.replace(/\.md$/, "") as keyof typeof POLICY;
    const head = /^---\n([\s\S]*?)\n---/.exec(read(`claude-plugin/agents/${name}`))?.[1] ?? "";
    const want = CATALOG.find((c) => c.tier === POLICY[role]?.tier)?.alias;
    assert.ok(want, `${name}: no policy row for ${role}`);
    assert.match(head, new RegExp(`^model: ${want}$`, "m"), `${name} frontmatter model`);
    assert.match(head, new RegExp(`^effort: ${POLICY[role]?.effort}$`, "m"), `${name} frontmatter effort`);
  }
});

test("resolve raises effort along the ladder first, then the next tier only with a reason", () => {
  const d = POLICY.design;
  const top = d.raiseEffort.at(-1);
  assert.ok(top && d.thenTier);
  const plain = resolve("design");
  assert.ok(plain.ok && !plain.value.escalated && plain.value.effort === d.effort);
  assert.equal(resolve("design", { effort: top }).ok, false, "a raise needs a reason");
  assert.equal(resolve("design", { tier: d.thenTier, reason: "r" }).ok, false, "tier before effort");
  assert.equal(resolve("design", { effort: "low", reason: "r" }).ok, false, "off the ladder");
  const up = resolve("design", { effort: top, tier: d.thenTier, reason: "r" });
  assert.ok(up.ok && up.value.tier === d.thenTier && up.value.escalated?.reason === "r");
  assert.equal(resolve("release-review", { tier: "fast", reason: "cheaper" }).ok, false, "no tier below");
});

function ctx(o: { now: Date; version: string; env?: Record<string, string>; home: string }) {
  return {
    orca: {} as never,
    exec: async () => ({ code: 0, stdout: `${o.version} (Claude Code)\n`, stderr: "" }),
    coreVersion: "0",
    home: o.home,
    now: o.now,
    env: o.env ?? {},
  };
}

test("doctor's model-table row: ok when fresh, warn past the floor, notice on a newer Claude Code or a pin", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-models-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const verified = Math.min(...CATALOG.map((c) => Date.parse(c.verified)));
  const fresh = new Date(verified + 86_400_000);
  const ok = await modelTable.run(ctx({ now: fresh, version: VERIFIED_WITH_CLAUDE_CODE, home }));
  assert.equal(ok.status, "ok", ok.summary);
  const old = new Date(verified + (STALE_DAYS + 1) * 86_400_000);
  assert.equal(catalogAgeDays(old), STALE_DAYS + 1);
  assert.equal((await modelTable.run(ctx({ now: old, version: VERIFIED_WITH_CLAUDE_CODE, home }))).status, "warn");
  assert.equal((await modelTable.run(ctx({ now: fresh, version: "999.0.0", home }))).status, "notice");
  const envPin = await modelTable.run(ctx({ now: fresh, version: VERIFIED_WITH_CLAUDE_CODE, home, env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "x" } }));
  assert.equal(envPin.status, "notice");
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ env: { ANTHROPIC_DEFAULT_FABLE_MODEL: "y" }, modelSettings: { z: {} } }));
  const filePin = await modelTable.run(ctx({ now: fresh, version: VERIFIED_WITH_CLAUDE_CODE, home }));
  assert.equal(filePin.status, "notice");
  assert.match(filePin.summary, /ANTHROPIC_DEFAULT_FABLE_MODEL=y/);
  assert.match(filePin.summary, /modelSettings\.z/);
});
