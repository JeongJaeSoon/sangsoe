import { isAbsolute, join } from "node:path";
import { has, type Parsed, parse, scriptPath, unwrap } from "./shell.ts";
import type { Facts, Gate, ToolCall, Verdict } from "./types.ts";

// Decision 94 (마): the start guard. The core's own Orca calls run as child processes of the MCP server
// or the CLI, so PreToolUse never sees them and no marker is needed to let them through; the guard reads
// only what the model asks Bash to run. Messages name each kind rather than quote the command, so the
// repository-wide scan for raw starts (test/lineage) does not read this file as one.

export const START_TOOL = "start_unit";
export const START_TOOL_ID = "mcp__plugin_sangsoe_sangsoe__start_unit";

const FIX =
  `Agents: call the MCP tool ${START_TOOL} (${START_TOOL_ID}), the one core start path. ` +
  "People: create the item with `sangsoe item new` and the orchestrator starts it. " +
  "Do not reach the same start another way (a script, another session, another tool).";

const KIND = {
  fallback: "a fallback start through Orca's agent-launch command",
  worktree: "a worktree opened with a prompt or an agent",
  claude: "a claude session detached from this shell",
  dispatch: "an unsupervised Orca dispatch",
  workerStart: "a worker-start called outside the core start path",
  interpreter: "a session start inside an interpreter one-liner",
} as const;

// claude subcommands that open no session.
const CLAUDE_TOOLS = new Set(["plugin", "plugins", "mcp", "config", "doctor", "update", "install", "migrate-installer", "setup-token"]);
const INTERPRETER = /^(python[\d.]*|node|perl|ruby|osascript|deno|bun)$/;
// Loose forms for code we cannot parse as shell (an interpreter's -c text).
const LOOSE = [
  /orca\W{1,6}agent\W{1,6}launch/,
  /orca\W{1,12}orchestration\W{1,6}(dispatch|worker-start)\b/,
  /worktree\W{1,6}create[\s\S]{0,200}--(prompt|agent)\b/,
  /nohup\W{1,6}claude\b/,
];

const positionals = (argv: readonly string[]) => argv.slice(1).filter((a) => !a.startsWith("-"));

function rawStart(parsed: Parsed, toolBackground: boolean): string | undefined {
  for (const cmd of parsed.commands) {
    const a = unwrap(cmd.words);
    const [head] = a.argv;
    if (has(a.argv, "--help") || has(a.argv, "-h")) continue;
    const [p0, p1] = positionals(a.argv);
    if (head === "orca") {
      if (p0 === "agent" && p1 === "launch") return KIND.fallback;
      if (p0 === "worktree" && p1 === "create" && (has(a.argv, "--prompt") || has(a.argv, "--agent"))) return KIND.worktree;
      if (p0 === "orchestration" && p1 === "dispatch") return KIND.dispatch;
      if (p0 === "orchestration" && p1 === "worker-start") return KIND.workerStart;
    }
    if (head === "claude" && (cmd.background || a.detached || toolBackground)) {
      if (!(p0 && CLAUDE_TOOLS.has(p0)) && !has(a.argv, "--version") && !has(a.argv, "-v")) return KIND.claude;
    }
    if (head && INTERPRETER.test(head)) {
      const code = a.argv.slice(1).join(" ");
      if (LOOSE.some((re) => re.test(code))) return KIND.interpreter;
    }
  }
  return undefined;
}

export const startGuard: Gate = (call: ToolCall, facts: Facts): Verdict | null => {
  if (call.tool !== "Bash") return null;
  const text = String(call.input.command ?? "");
  const background = call.input.run_in_background === true;
  const parsed = parse(text);
  let kind = rawStart(parsed, background);
  if (!kind) {
    // A start wrapped in a script file is the same start (R-10): read each script once, no deeper.
    for (const cmd of parsed.commands) {
      const path = scriptPath(unwrap(cmd.words));
      if (!path) continue;
      const script = facts.readScript(isAbsolute(path) ? path : join(call.cwd, path));
      const inner = script === undefined ? undefined : rawStart(parse(script), background || cmd.background);
      if (inner) {
        kind = `${inner}, inside ${path}`;
        break;
      }
    }
  }
  if (!kind) return null;
  return {
    decision: "deny",
    gate: "start",
    reason: `[gate:start] Refused: ${kind} opens a session outside the core start path (decision 94). ${FIX}`,
  };
};
