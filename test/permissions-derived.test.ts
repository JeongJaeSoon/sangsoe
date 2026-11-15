import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sangsoeRules } from "../core/index.ts";
import { derive, renderGenerated } from "../scripts/permissions/derive.ts";
import { GH_POLICY, ORCA_POLICY } from "../scripts/permissions/policy.ts";

// Decision 265: the rule set is what sangsoe's own sources run, not a hand list.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOME = "/home/acme";
const resolve = (rule: string) => rule.replace("{HOME}", HOME.slice(1));

test("every command a source runs has a policy entry", () => {
  const d = derive(ROOT);
  assert.deepEqual(
    d.unclassified.map((h) => `${h.file}:${h.line} ${h.path}`),
    [],
  );
  assert.deepEqual(d.unlisted, []);
});

test("every policy entry is run by a source or declares why not", () => {
  assert.deepEqual(derive(ROOT).stale, []);
});

test("the installed rule set is the derived one: no used command without a rule, no rule for nothing used", () => {
  const derived = derive(ROOT).rules.map((r) => resolve(r.rule));
  const have = sangsoeRules(HOME);
  assert.deepEqual(
    derived.filter((r) => !have.includes(r)),
    [],
    "a command sangsoe runs has no rule",
  );
  assert.deepEqual(
    have.filter((r) => !derived.includes(r)),
    [],
    "a rule covers nothing sangsoe runs",
  );
});

test("the checked-in generated file is what the sources derive", () => {
  assert.equal(readFileSync(join(ROOT, "core/install/permissions.generated.ts"), "utf8"), renderGenerated(derive(ROOT)));
});

test("no rule is a bare prefix over a destructive form, and starts are never ruled", () => {
  const rules = derive(ROOT).rules.map((r) => r.rule);
  for (const r of rules) {
    assert.doesNotMatch(r, /^Bash\(orca terminal (close|read|send):\*\)$/, r);
  }
  assert.ok(rules.includes("Bash(orca terminal read --terminal term_*)"));
  assert.ok(rules.includes("Bash(orca terminal send --terminal term_*)"));
  for (const [path, e] of Object.entries(ORCA_POLICY)) if (e.kind === "deny") assert.ok(!rules.some((r) => r.startsWith(`Bash(orca ${path}`)), path);
  for (const [path, e] of Object.entries(GH_POLICY)) if (e.kind === "deny") assert.ok(!rules.some((r) => r.startsWith(`Bash(gh ${path}`)), path);
  assert.ok(rules.includes("Bash(gh pr view:*)"));
});

test("the sangsoe commands a gate or skill tells a session to run: read-only verbs are ruled, mutating ones are not", () => {
  const rules = derive(ROOT).rules.map((r) => r.rule);
  // core/gates/pressure.ts tells every role to run this in the background after a refusal.
  for (const verb of ["pressure wait", "brief", "todo", "doctor"]) assert.ok(rules.includes(`Bash(sangsoe ${verb}:*)`), verb);
  for (const verb of ["install", "uninstall", "land", "plugin approve", "item new", "reap"]) assert.ok(!rules.some((r) => r.startsWith(`Bash(sangsoe ${verb}`)), verb);
});

test("a sangsoe command a skill runs that the policy does not name is reported with its file:line", () => {
  const root = fixture({ "claude-plugin/skills/x/SKILL.md": "intro\nrun `sangsoe frobnicate --now` here\n" });
  try {
    assert.deepEqual(
      derive(root).unclassified.map((h) => `${h.file}:${h.line} ${h.path}`),
      ["claude-plugin/skills/x/SKILL.md:2 sangsoe frobnicate"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a sangsoe command named in a gate's text counts as a use", () => {
  const root = fixture({ "core/gates/x.ts": 'const why = "run sangsoe pressure wait in the background";\n' });
  try {
    assert.ok(derive(root).rules.some((r) => r.rule === "Bash(sangsoe pressure wait:*)" && r.source === "core/gates/x.ts"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no rule holds a machine path", () => {
  const text = renderGenerated(derive(ROOT));
  assert.doesNotMatch(text, /\/Users\/|\/home\/|\/private\/var|\/tmp\//);
  assert.match(text, /\{HOME\}/);
});

// A fixture tree shaped like the repository, so the checks can be shown to fire.
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "sangsoe-derive-test-"));
  const base: Record<string, string> = {
    "claude-plugin/.claude-plugin/plugin.json": '{"name":"acme"}',
    "claude-plugin/.mcp.json": '{"mcpServers":{"srv":{}}}',
    "core/orca/commands.ts": "export const ORCA_COMMANDS = {};\n",
    "core/session/session-start.ts": "",
  };
  for (const [p, t] of Object.entries({ ...base, ...files })) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  return root;
}

test("a command a skill runs that the policy does not name is reported with its file:line", () => {
  const root = fixture({ "claude-plugin/skills/x/SKILL.md": "intro\nrun `orca orchestration frobnicate --now` here\n" });
  try {
    const d = derive(root);
    assert.deepEqual(
      d.unclassified.map((h) => `${h.file}:${h.line} ${h.path}`),
      ["claude-plugin/skills/x/SKILL.md:2 orca orchestration frobnicate"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown command in the session text, a quoted command and a bare Orca verb in a skill are all reported", () => {
  const root = fixture({
    "core/session/session-start.ts": "const t = `run orca orchestration frobnicate now`;\n",
    "claude-plugin/skills/x/SKILL.md": 'run `bash -c "orca terminal wipe --x"` or Orca `worker-stop --dispatch d`, Orca `send`\n',
  });
  try {
    const d = derive(root);
    assert.deepEqual(
      d.unclassified.map((h) => `${h.file}:${h.line} ${h.path}`).sort(),
      [
        "claude-plugin/skills/x/SKILL.md:1 orca orchestration worker-stop",
        "claude-plugin/skills/x/SKILL.md:1 orca terminal wipe",
        "core/session/session-start.ts:1 orca orchestration frobnicate",
      ],
    );
    assert.ok(d.rules.some((r) => r.rule === "Bash(orca orchestration send:*)" && r.source === "claude-plugin/skills/x/SKILL.md"), "the shorthand counts as a use of orchestration send");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a rule nothing runs is stale, a declared one is not", () => {
  const root = fixture({ "claude-plugin/skills/x/SKILL.md": "run `orca status`\n" });
  try {
    const d = derive(root);
    assert.ok(d.stale.includes("orca worktree set"), "an allow entry no source runs is stale");
    assert.ok(!d.stale.includes("orca terminal read"), "a declared entry is not");
    assert.ok(d.rules.some((r) => r.rule === "Bash(orca status:*)" && r.source === "claude-plugin/skills/x/SKILL.md"));
    assert.ok(!d.rules.some((r) => r.rule === "Bash(orca worktree set:*)"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a literal gh, git or orca call in code that the policy does not list is reported", () => {
  const root = fixture({ "core/x/run.ts": 'await exec("gh", ["release", "delete"]);\nawait exec("orca", ["automation", "run"]);\n' });
  try {
    assert.deepEqual(derive(root).unlisted.map((u) => u.key).sort(), ["gh release", "orca automation run"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
