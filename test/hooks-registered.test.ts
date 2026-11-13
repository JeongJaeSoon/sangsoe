import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scratchDir } from "./scratch.ts";

// R-01 (#459, #467): every path the plugin registers exists, and a script run directly has its exec bit.
// The build maps a source file to dist/ by its extension, so dist/<x>.js stands for <x>.ts here.

const ROOT = new URL("../", import.meta.url);
const PLUGIN = new URL("claude-plugin/", ROOT);
const at = (rel: string) => new URL(rel, PLUGIN);

type HookEntry = { type: string; command: string; timeout?: number; onFailure?: string };
const hooks = JSON.parse(readFileSync(at("hooks/hooks.json"), "utf8")) as {
  hooks: Record<string, { matcher?: string; hooks: HookEntry[] }[]>;
};
const entries = Object.values(hooks.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
const PLUGIN_PATH = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s;]+)/g;

test("every path a hook command names exists in the plugin, and one run directly is executable", () => {
  assert.ok(entries.length > 0);
  for (const h of entries) {
    const paths = [...h.command.matchAll(PLUGIN_PATH)].map((m) => m[1] ?? "");
    assert.ok(paths.length > 0, `hook command names a plugin path: ${h.command}`);
    for (const rel of paths) {
      assert.ok(existsSync(at(rel)), `${rel} exists`);
      const direct = h.command.trimStart().startsWith(`"\${CLAUDE_PLUGIN_ROOT}/${rel}`);
      if (direct) assert.ok((statSync(at(rel)).mode & 0o111) !== 0, `${rel} is executable`);
    }
  }
});

// Decision 208: a hook that cannot start (sangsoe removed or swapped by brew) lets the call go ahead, so a
// running session is not frozen; the script itself holds the call with exit 2 when its check fails.
test("the PreToolUse hook is one command hook over every tool whose failure to start does not block", () => {
  const pre = hooks.hooks.PreToolUse ?? [];
  assert.equal(pre.length, 1);
  assert.equal(pre[0]?.matcher, "*");
  assert.deepEqual(
    pre[0]?.hooks.map((h) => [h.type, h.onFailure]),
    [["command", "continue"]],
  );
});

const preCommand = hooks.hooks.PreToolUse?.[0]?.hooks[0]?.command ?? "";
const NODE_DIR = dirname(process.execPath);

/** The hooks.json command as Claude Code runs it, in a scratch tree whose dist/cli/main.js is `cli`. */
function runPreHook(o: { cli?: string; pluginRoot?: string; path?: string }) {
  const tree = scratchDir("sangsoe-pre-");
  mkdirSync(join(tree, "claude-plugin", "hooks"), { recursive: true });
  writeFileSync(join(tree, "claude-plugin", "hooks", "pre-tool-use.sh"), readFileSync(at("hooks/pre-tool-use.sh")));
  if (o.cli !== undefined) {
    mkdirSync(join(tree, "dist", "cli"), { recursive: true });
    writeFileSync(join(tree, "dist", "cli", "main.js"), o.cli);
  }
  return spawnSync("sh", ["-c", preCommand], {
    input: "{}",
    encoding: "utf8",
    env: { PATH: o.path ?? `${NODE_DIR}:/usr/bin:/bin`, CLAUDE_PLUGIN_ROOT: o.pluginRoot ?? join(tree, "claude-plugin") },
  });
}

test("a check that prints a deny exits 0 and passes the deny through", () => {
  const deny = JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  const r = runPreHook({ cli: `console.log(${JSON.stringify(deny)});` });
  assert.deepEqual([r.status, r.stdout], [0, `${deny}\n`], r.stderr);
});

test("a check that fails in any way holds the call with exit 2", () => {
  for (const cli of ["process.exit(1);", "process.exit(2);", "throw new Error('broken install');"]) {
    const r = runPreHook({ cli });
    assert.equal(r.status, 2, `${cli}: ${r.stderr}`);
    assert.match(r.stderr, /this call is held/);
  }
});

test("no sangsoe CLI at all is a non-blocking error, never exit 2", () => {
  const r = runPreHook({ path: "/usr/bin:/bin" });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /gates are off for this call/);
});

test("a plugin directory that is gone is a non-blocking error, never exit 2", { skip: process.platform !== "darwin" && "dash exits 2 on a missing script; sangsoe ships for macOS" }, () => {
  const r = runPreHook({ pluginRoot: join(tmpdir(), "sangsoe-pre-gone", "claude-plugin") });
  assert.notEqual(r.status, 2, r.stderr);
  assert.notEqual(r.status, 0, r.stderr);
});

test("the seven recording hooks run record.sh with their event and never block", () => {
  const expected: Record<string, string> = {
    SessionStart: "session-start",
    UserPromptSubmit: "user-prompt-submit",
    Stop: "stop",
    Notification: "notification",
    PostToolUse: "post-tool-use",
    PostCompact: "post-compact",
    SessionEnd: "session-end",
  };
  for (const [event, arg] of Object.entries(expected)) {
    const group = hooks.hooks[event] ?? [];
    assert.equal(group.length, 1, event);
    assert.deepEqual(
      group[0]?.hooks.map((h) => [h.type, h.command, h.onFailure]),
      [["command", `sh "\${CLAUDE_PLUGIN_ROOT}/hooks/record.sh" ${arg}`, undefined]],
      event,
    );
  }
  assert.match(readFileSync(at("hooks/record.sh"), "utf8"), /\/\.\.\/dist\/cli\/main\.js/);
});

test("record.sh exits 0 even when the CLI it finds exits 2, and keeps its stdout", () => {
  const tmp = scratchDir("sangsoe-record-");
  mkdirSync(join(tmp, "plugin"));
  mkdirSync(join(tmp, "bin"));
  // An older CLI on PATH that does not know the event: prints, then exits 2.
  writeFileSync(join(tmp, "bin", "sangsoe"), "#!/bin/sh\necho injected\nexit 2\n");
  chmodSync(join(tmp, "bin", "sangsoe"), 0o755);
  const run = (path: string) =>
    spawnSync("sh", [fileURLToPath(at("hooks/record.sh")), "stop"], {
      encoding: "utf8",
      env: { PATH: path, CLAUDE_PLUGIN_ROOT: join(tmp, "plugin") },
    });
  const r = run(`${join(tmp, "bin")}:/usr/bin:/bin`);
  assert.deepEqual([r.status, r.stdout], [0, "injected\n"]);
  assert.equal(run("/usr/bin:/bin").status, 0, "no CLI at all");
});

test("the entry script and the MCP registration point at files the build produces", () => {
  const entry = readFileSync(at("hooks/pre-tool-use.sh"), "utf8");
  assert.match(entry, /\/\.\.\/dist\/cli\/main\.js/);
  assert.ok(existsSync(new URL("cli/main.ts", ROOT)));

  const mcp = JSON.parse(readFileSync(at(".mcp.json"), "utf8")) as { mcpServers: Record<string, { args: string[] }> };
  const line = mcp.mcpServers.sangsoe?.args.join(" ") ?? "";
  assert.ok(line.includes(`$\{CLAUDE_PLUGIN_ROOT}/../dist/claude-plugin/mcp/server.js`), "source checkout and brew tree");
  assert.ok(line.includes("/../libexec/dist/claude-plugin/mcp/server.js"), "an installed copy finds the brew tree");
  assert.ok(existsSync(at("mcp/server.ts")));
});
