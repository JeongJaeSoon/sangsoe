// Decisions 164-165: core/models/table.ts is the one model-selection table. This fails when a role or
// kind has no row, when a row points nowhere, when a second copy of the table (or a version number)
// appears anywhere else, and when an agent's frontmatter model or effort disagrees with the table.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import {
  ADVISOR_FROM_SETTING,
  ADVISOR_NOT_APPLIED,
  modelRowLines,
  MODEL_CATALOG as CATALOG,
  catalogAgeDays,
  classKind,
  launchModel,
  modelPairing,
  UNIT_CLASSES,
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
// docs/models.md is generated from the table and held to it by test/models-view.test.ts (decision 200).
const EXEMPT = new Set([HOME, "docs/decisions.md", "docs/models.md", "test/model-table.test.ts", "package-lock.json"]);

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
  assert.equal(up.value.effort, "high", "the frontier tier starts at high, not at the ladder's max (decision 172)");
  // Decision 200: the implementation worker raises effort back first, then moves to primary at its starting effort.
  assert.equal(resolve("worker", { tier: "primary", reason: "failed review twice" }).ok, false, "effort before tier");
  const worker = resolve("worker", { effort: "high", tier: "primary", reason: "failed review twice" });
  assert.ok(worker.ok && worker.value.tier === "primary" && worker.value.effort === "medium" && worker.value.advisorTier === "frontier");
  for (const kind of ["orchestrator", "lead", "hard", "review"] as const) {
    const row = POLICY[kind];
    const [effort, tier] = [row.raiseEffort.at(-1), row.thenTier];
    assert.ok(effort && tier, kind);
    const moved = resolve(kind, { effort, tier, reason: "r" });
    assert.ok(moved.ok && moved.value.tier === "frontier" && moved.value.effort === "high", kind);
  }
  const release = resolve("release-review");
  assert.ok(release.ok && release.value.effort === "high", "the frontier row itself starts at high");
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
  // Decision 187: no advisorModel key is a notice naming the owner's act; the key's value is never read.
  const none = await modelTable.run(ctx({ now: fresh, version: VERIFIED_WITH_CLAUDE_CODE, home }));
  assert.equal(none.status, "notice");
  assert.match(none.summary, /advisor not applied/);
  assert.match(none.fix ?? "", /owner's act/);
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ advisorModel: "secret-value" }));
  const ok = await modelTable.run(ctx({ now: fresh, version: VERIFIED_WITH_CLAUDE_CODE, home }));
  assert.equal(ok.status, "ok", ok.summary);
  assert.doesNotMatch(ok.summary, /secret-value/);
  const off = await modelTable.run(ctx({ now: fresh, version: VERIFIED_WITH_CLAUDE_CODE, home, env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" } }));
  assert.equal(off.status, "notice", "the advisor's off switch counts as no advisor");
  // Two owner-setting findings get both owner fixes, not the table-update fix.
  const both = await modelTable.run(
    ctx({ now: fresh, version: VERIFIED_WITH_CLAUDE_CODE, home, env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1", ANTHROPIC_DEFAULT_OPUS_MODEL: "x" } }),
  );
  assert.match(both.fix ?? "", /owner's act/);
  assert.match(both.fix ?? "", /pins are the owner's settings/);
  assert.doesNotMatch(both.fix ?? "", /re-read the pages/);
  const old = new Date(verified + (STALE_DAYS + 1) * 86_400_000);
  assert.equal(catalogAgeDays(old), STALE_DAYS + 1);
  assert.equal((await modelTable.run(ctx({ now: old, version: VERIFIED_WITH_CLAUDE_CODE, home }))).status, "warn");
  assert.equal((await modelTable.run(ctx({ now: fresh, version: "999.0.0", home }))).status, "notice");
  const envPin = await modelTable.run(ctx({ now: fresh, version: VERIFIED_WITH_CLAUDE_CODE, home, env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "x" } }));
  assert.equal(envPin.status, "notice");
  writeFileSync(
    join(home, ".claude", "settings.json"),
    JSON.stringify({ advisorModel: "a", env: { ANTHROPIC_DEFAULT_FABLE_MODEL: "y" }, modelSettings: { z: {} } }),
  );
  const filePin = await modelTable.run(ctx({ now: fresh, version: VERIFIED_WITH_CLAUDE_CODE, home }));
  assert.equal(filePin.status, "notice");
  assert.match(filePin.summary, /ANTHROPIC_DEFAULT_FABLE_MODEL=y/);
  assert.match(filePin.summary, /modelSettings\.z/);
});

const aliasOf = (tier: string) => CATALOG.find((c) => c.tier === tier)?.alias;

test("decision 187: every policy row's advisor pairs with its main tier, before and after its move", () => {
  for (const [kind, row] of Object.entries(POLICY) as [keyof typeof POLICY, (typeof POLICY)[keyof typeof POLICY]][]) {
    for (const adv of [row.advisor, row.thenAdvisor]) if (adv) assert.equal(modelPairing(row.tier, adv), null, `${kind} advisor`);
    const plain = resolve(kind);
    assert.ok(plain.ok, kind);
    assert.equal(plain.value.advisor, row.advisor ? aliasOf(row.advisor) : undefined, `${kind} advisor alias`);
    if (!row.thenTier) continue;
    const top = row.raiseEffort.at(-1) ?? row.effort;
    const moved = resolve(kind, { effort: top, tier: row.thenTier, reason: "r" });
    assert.ok(moved.ok, `${kind} after its move: ${moved.ok ? "" : moved.reason}`);
    if (moved.value.advisorTier) assert.equal(modelPairing(moved.value.tier, moved.value.advisorTier), null, kind);
  }
  assert.notEqual(POLICY.worker.tier, "fast", "never the fast tier for implementation");
  assert.equal(POLICY[classKind("mechanical")].tier, "fast");
  assert.deepEqual(UNIT_CLASSES.map(classKind), ["worker", "hard", "design", "sweep", "docs"]);
});

test("decision 187: an advisor below the main tier, or the fast tier as advisor, is refused", () => {
  assert.match(modelPairing("everyday", "fast") ?? "", /does not advise/);
  assert.match(modelPairing("primary", "everyday") ?? "", /ranks below/);
  assert.equal(modelPairing("everyday", "primary"), null);
  assert.equal(modelPairing("primary", "primary"), null, "the same tier may advise");
});

test("decision 187: launch passes --advisor only through Orca, and the worker row never runs its main tier without one", () => {
  const w = resolve("worker");
  assert.ok(w.ok && w.value.advisor);
  const viaOrca = launchModel(w.value, { orcaFlag: true, ownerSetting: false });
  assert.deepEqual(viaOrca, { model: aliasOf("everyday"), effort: "medium", advisor: aliasOf("primary"), route: "orca_flag" });
  const viaSetting = launchModel(w.value, { orcaFlag: false, ownerSetting: true });
  assert.deepEqual(viaSetting, { model: aliasOf("everyday"), effort: "medium", route: "owner_setting", note: ADVISOR_FROM_SETTING });
  const none = launchModel(w.value, { orcaFlag: false, ownerSetting: false });
  assert.equal(none.model, aliasOf("primary"));
  assert.equal(none.advisor, undefined);
  assert.equal(none.note, ADVISOR_NOT_APPLIED);
  assert.ok(none.fallback?.reason);
  const hard = resolve("hard");
  assert.ok(hard.ok);
  const hardNone = launchModel(hard.value, { orcaFlag: false, ownerSetting: false });
  assert.equal(hardNone.model, aliasOf("primary"), "a row already at its floor keeps its model");
  assert.equal(hardNone.fallback, undefined);
  const review = resolve("review");
  assert.ok(review.ok);
  assert.deepEqual(launchModel(review.value, { orcaFlag: true, ownerSetting: true }), { model: aliasOf("primary"), effort: "high", route: "none" });
});

test("decision 200: falling to the floor tier keeps an effort the lead already raised", () => {
  const raised = resolve("worker", { effort: "high", reason: "first Act-on" });
  assert.ok(raised.ok);
  const floor = launchModel(raised.value, { orcaFlag: false, ownerSetting: false });
  assert.equal(floor.model, aliasOf("primary"));
  assert.equal(floor.effort, "high", "not the floor tier's lower API default");
});

// The eight cases the owner named (2026-11-11), each one row.
const CASES: Record<string, keyof typeof POLICY> = {
  mechanical: "sweep",
  docs: "docs",
  implementation: "worker",
  "hard implementation": "hard",
  "root-cause/design": "design",
  review: "review",
  "final stable review": "release-review",
  lead: "lead",
};

test("decision 200: every case has a row with tier, effort, advisor or none, a budget, a trigger, a why and a source", () => {
  for (const [name, kind] of Object.entries(CASES)) {
    const row = POLICY[kind];
    assert.ok(row.label && row.why && row.trigger, name);
    assert.ok(SOURCES[row.cite].startsWith("https://"), name);
    // A budget exactly when the row asks for an advisor.
    assert.equal(row.budget.calls > 0, row.advisor !== undefined, `${name}: budget and advisor agree`);
    assert.ok(row.budget.calls <= 3 || row.budget.per === "day", `${name}: about 2-3 calls a unit`);
    for (const text of [row.why, row.label]) assert.doesNotMatch(text, /\b(fable|opus|sonnet|haiku)\b|\d+\.\d+/i, `${name}: ${text}`);
  }
  assert.equal(POLICY.lead.budget.per, "day");
  // xhigh is never a starting effort, and the frontier tier starts at high.
  for (const row of Object.values(POLICY)) {
    assert.notEqual(row.effort, "xhigh");
    assert.notEqual(row.effort, "max");
    if (row.tier === "frontier") assert.equal(row.effort, "high");
  }
  assert.equal(POLICY.sweep.effort, "low", "mechanical runs at low");
  assert.equal(POLICY.worker.effort, "medium", "implementation one step down, with its advisor");
  assert.equal(POLICY.hard.effort, "high", "hard implementation one step up");
  assert.equal(POLICY.docs.tier, POLICY.worker.tier, "docs on the implementation tier");
  assert.equal(classKind("docs"), "docs");
});

test("decision 200: a row below high gets the finish-the-whole-task line, and a row with a budget gets the budget line", () => {
  const at = (kind: keyof typeof POLICY, route: "owner_setting" | "none" = "owner_setting") => {
    const row = POLICY[kind];
    return modelRowLines({ effort: row.effort, route: row.advisor ? route : "none", budget: row.budget.calls, budget_per: row.budget.per });
  };
  assert.ok(at("sweep").some((l) => l.startsWith("일 전체를 끝까지")));
  assert.ok(!at("design").some((l) => l.startsWith("일 전체를 끝까지")));
  assert.ok(at("worker").some((l) => l.includes(`${POLICY.worker.budget.calls}회`)));
  assert.deepEqual(at("review"), [], "no advisor, high effort: nothing to add");
  assert.match(at("lead")[0] ?? "", /하루/);
  // An advisor that did not attach: no budget line to follow.
  assert.ok(!at("worker", "none").some((l) => l.startsWith("advisor")));
});
