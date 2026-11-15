// Owner requirement d125 (4) and split U20: the role, completion and depth rules live in the judgment
// prompts and in the core start checks, as the same sentences.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { evaluate, type GateFacts } from "../core/index.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const AGENTS = ["orchestrator", "lead", "worker"].map((n) => `claude-plugin/agents/${n}.md`);
const RULE_SKILLS = ["start", "orchestrate"].map((n) => `claude-plugin/skills/${n}/SKILL.md`);
const SKILLS = [
  "intake",
  "write-brief",
  "brief",
  "todo",
  "deliver-ticket",
  "orchestrate",
  "start",
  "end-session",
  "reflect",
  "reap-resources",
  "setup",
];
const OWNER_ONLY = new Set(["brief", "todo"]);

// Sentences the core start function (U10) enforces and says in its refusals. Each must appear, as
// written, in the rules block of every prompt above.
const CORE_SENTENCES = ["워커는 세션을 시작하지 않는다", "리드는 리드를 시작하지 않는다", "오케스트레이터의 자식은 1", "start_refused"];
const CORE_SOURCES = ["core/start/start.ts"];

const BLOCK = /<!-- sangsoe:rules:begin -->\n([\s\S]*?)\n<!-- sangsoe:rules:end -->/;
const block = (rel: string) => {
  const m = BLOCK.exec(read(rel));
  assert.ok(m, `${rel} has no sangsoe:rules block`);
  return m[1] ?? "";
};

test("every agent and the start and orchestrate skills carry the same rules block", () => {
  const files = [...AGENTS, ...RULE_SKILLS];
  const first = block(files[0] ?? "");
  for (const f of files.slice(1)) assert.equal(block(f), first, `${f} rules block differs from ${files[0]}`);
});

test("the rules block states each rule the core start checks enforce", () => {
  const text = block(AGENTS[0] ?? "");
  for (const s of CORE_SENTENCES) assert.ok(text.includes(s), `rules block lacks: ${s}`);
});

test("the core start checks say the same sentences", () => {
  const core = CORE_SOURCES.map(read).join("\n");
  for (const s of CORE_SENTENCES) assert.ok(core.includes(s), `core start code no longer says: ${s}`);
});

// The CLI's subcommands today and the ones the plan adds (brief, todo, land, recover, graph, ...).
// `pressure` stays out: `sangsoe pressure wait` is the one call agent bodies name (decision 256).
const CLI_CALL =
  /\bsangsoe\s+(install|uninstall|doctor|plugin|brief|todo|land|review|recover|item|graph|decision|verify|notify|owner|--)/;

test("agent bodies reach sangsoe through MCP, never through a shell command", () => {
  assert.match("run sangsoe review record --pr 3", CLI_CALL);
  assert.doesNotMatch("one sangsoe program", CLI_CALL);
  for (const f of AGENTS) {
    const text = read(f);
    assert.doesNotMatch(text, CLI_CALL, `${f} names a sangsoe CLI command`);
    assert.doesNotMatch(text, /!`/, `${f} injects shell output`);
  }
});

test("the delegate gate lets the orchestrator read each sangsoe resource its agent text names", () => {
  // Claude Code names a plugin's server `plugin:<plugin name>:<.mcp.json key>` (appendix #mcp).
  const plugin = (JSON.parse(read("claude-plugin/.claude-plugin/plugin.json")) as { name: string }).name;
  const servers = Object.keys((JSON.parse(read("claude-plugin/.mcp.json")) as { mcpServers: object }).mcpServers);
  const named = [...read("claude-plugin/agents/orchestrator.md").matchAll(/resource `([a-z_]+)`/g)].map((m) => m[1] ?? "");
  assert.ok(named.length > 0, "orchestrator.md names no resource");
  const role: GateFacts = { role: () => "orchestrator", load: () => ({ level: "ok", reasons: [] }), ownOpenPrs: () => undefined, readScript: () => undefined, doneBlockers: () => [], sangsoe: () => true };
  const verdict = (tool: string, input: Record<string, unknown>) =>
    evaluate({ tool, input, cwd: "/work/acme", subagent: false }, role).decision;
  // The agent text names a resource, not its server: the first call is a list with no server.
  assert.notEqual(verdict("ListMcpResourcesTool", {}), "deny", "listing every server's resources denied");
  for (const key of servers) {
    const server = `plugin:${plugin}:${key}`;
    assert.notEqual(verdict("ListMcpResourcesTool", { server }), "deny", `${server}: listing denied`);
    for (const name of named) {
      const uri = /uri: "([^"]+)"/.exec(read(`claude-plugin/mcp/resources/${name}.ts`))?.[1];
      assert.ok(uri, `resource ${name} has no uri`);
      assert.notEqual(verdict("ReadMcpResourceTool", { server, uri }), "deny", `${uri}: read denied`);
    }
  }
  assert.equal(verdict("ReadMcpResourceTool", { server: "plugin:other:x", uri: "other://doc" }), "deny");
});

test("only the owner-only skills inject CLI output, and the model cannot invoke them", () => {
  for (const name of SKILLS) {
    const text = read(`claude-plugin/skills/${name}/SKILL.md`);
    const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
    assert.match(head, new RegExp(`^name: ${name}$`, "m"), `${name}: frontmatter name`);
    assert.match(head, /^description: \S/m, `${name}: frontmatter description`);
    const ownerOnly = /^disable-model-invocation: true$/m.test(head);
    assert.equal(ownerOnly, OWNER_ONLY.has(name), `${name}: disable-model-invocation`);
    if (OWNER_ONLY.has(name)) {
      assert.match(text, new RegExp(`!\`sangsoe ${name}\\b`), `${name}: injects \`sangsoe ${name}\``);
      assert.match(head, new RegExp(`^allowed-tools: Bash\\(sangsoe ${name}:\\*\\)$`, "m"), `${name}: allowed-tools`);
    } else {
      assert.doesNotMatch(text, /!`/, `${name}: a model-invoked skill injects shell output`);
    }
  }
});

test("deliver-ticket lands through the land tool with tiered evidence and merge_ready", () => {
  const text = read("claude-plugin/skills/deliver-ticket/SKILL.md");
  for (const want of ["`land`", "`merge_ready`", "V0", "V1", "V2", "V3", "`evidence_missing", "`evidence_record`", "`stage_record`"]) {
    assert.ok(text.includes(want), `deliver-ticket lacks ${want}`);
  }
  assert.doesNotMatch(text, /gh\s+pr\s+merge/, "deliver-ticket calls GitHub's merge directly");
});

const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );

test("the judgment layer carries none of the old plumbing names", () => {
  const old = new RegExp(["orch ", "orch-dash", "skills-sync", "card\\.py", "agent-skills\\.json"].join("|"));
  const files = [...AGENTS, ...SKILLS.flatMap((n) => walk(`claude-plugin/skills/${n}`))];
  for (const f of files) assert.doesNotMatch(read(f), old, `${f} names old plumbing`);
});

test("each skill has a precision eval, and each model-invoked skill a trigger eval", () => {
  for (const name of SKILLS) {
    const cases = readdirSync(join(ROOT, `claude-plugin/skills/${name}/evals`));
    const graders = cases.flatMap((c) => walk(`claude-plugin/skills/${name}/evals/${c}/graders`).map(read));
    assert.ok(
      graders.some((g) => /^max: 0$/m.test(g)),
      `${name}: no case that must not fire`,
    );
    if (!OWNER_ONLY.has(name)) {
      assert.ok(
        graders.some((g) => !/^max: 0$/m.test(g)),
        `${name}: no case that must fire`,
      );
    }
  }
});
