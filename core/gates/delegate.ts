import { option, parse, unwrap } from "./shell.ts";
import type { Gate, ToolCall } from "./types.ts";

// Appendix #gates [gate:delegate]: the orchestrator's own turn holds only coordination. Its subagents and
// the workers it starts are not this gate's business. Writing a long message body to a file and sending
// it is a normal path and stays open (PR #135).

const TOOLS = new Set([
  "Agent",
  "Task",
  "SendMessage",
  "TaskStop",
  "TaskOutput",
  "ListAgents",
  "Skill",
  "ToolSearch",
  "AskUserQuestion",
  "ScheduleWakeup",
  "CronCreate",
  "CronDelete",
  "CronList",
  "EnterPlanMode",
  "ExitPlanMode",
]);
const READABLE = /\.(md|txt|json|jsonl|log)$/;
const WRITABLE = /\.(md|txt)$/;

const SUB: Record<string, RegExp> = {
  orca: /^(orchestration|worktree (list|show|ps)|terminal (list|read|show)|skills (get|list))\b/,
  gh: /^(pr (view|list|checks|diff|status)|run (view|list)|issue (view|list)|search|api)\b/,
  git: /^(status|log|show|diff|rev-parse|branch|worktree list|ls-remote)\b/,
};
const PLAIN = new Set(["cd", "pwd", "jq", "head", "tail", "wc", "sort", "uniq", "date", "true"]);

function coordination(argv: readonly string[]): boolean {
  const [head, ...rest] = argv;
  if (!head) return true;
  if (PLAIN.has(head)) return true;
  const sub = SUB[head];
  if (!sub) return false;
  const words = rest.filter((a) => !a.startsWith("-")).join(" ");
  // `gh api` stays a read: no method other than GET and no fields.
  if (head === "gh" && words.startsWith("api")) {
    const method = (option(rest, "-X") ?? option(rest, "--method") ?? "GET").toUpperCase();
    return method === "GET" && !rest.some((a) => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(a));
  }
  return sub.test(words);
}

// Decision 89: the orchestrator reads 현황 from sangsoe's resources through Claude Code's two built-in
// resource tools, which carry the server name instead of an mcp__ prefix.
const RESOURCE_TOOLS = new Set(["ListMcpResourcesTool", "ReadMcpResourceTool"]);

function allowed(call: ToolCall): boolean {
  if (TOOLS.has(call.tool) || call.tool.startsWith("mcp__plugin_sangsoe_")) return true;
  if (RESOURCE_TOOLS.has(call.tool)) return String(call.input.server ?? "").startsWith("plugin:sangsoe:");
  const file = String(call.input.file_path ?? call.input.path ?? "");
  if (call.tool === "Read") return READABLE.test(file);
  if (call.tool === "Write" || call.tool === "Edit") return WRITABLE.test(file);
  if (call.tool === "Bash" || call.tool === "Monitor") {
    return parse(String(call.input.command ?? "")).commands.every((c) => coordination(unwrap(c.words).argv));
  }
  return false;
}

export const delegateGate: Gate = (call, facts) => {
  if (call.subagent || allowed(call) || facts.role() !== "orchestrator") return null;
  return {
    decision: "deny",
    gate: "delegate",
    reason:
      `[gate:delegate] The orchestrator coordinates and does not do the work itself: this ${call.tool} call is outside ` +
      "coordination. Hand it down: start a worker with the MCP tool start_unit, or give it to a subagent (Agent). " +
      "A long message goes in a .md file sent with --body-file.",
  };
};
