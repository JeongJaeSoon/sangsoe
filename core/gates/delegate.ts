import { option, parse, unwrap } from "./shell.ts";
import type { Gate, ToolCall } from "./types.ts";

// Appendix #gates [gate:delegate]: the orchestrator's own turn holds only coordination. Its subagents and
// the workers it starts are not this gate's business. Writing a long message body to a file with the
// Write tool and sending it is a normal path and stays open (PR #135, decision 286).

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
// Decision 300: the output file Claude Code keeps for a background Bash of this session, e.g. the
// mail wait that woke the orchestrator. Reading it is how the wake-up is read.
const TASK_OUTPUT = /^\/(?:private\/)?(?:tmp|var\/folders\/[^/]+\/[^/]+\/T)\/claude-\d+\/[^/]+\/[^/]+\/tasks\/[^/]+\.output$/;
const readable = (f: string) => READABLE.test(f) || (TASK_OUTPUT.test(f) && !f.split("/").includes(".."));

const SUB: Record<string, RegExp> = {
  orca: /^(orchestration|worktree (list|show|ps|current)|terminal (list|read|show)|skills (get|list)|repo (list|show)|status)\b/,
  gh: /^(pr (view|list|checks|diff|status)|run (view|list)|issue (view|list)|search|api)\b/,
  git: /^(status|log|show|diff|rev-parse|branch|worktree list|ls-remote)\b/,
  // Decision 256: the wait a [gate:pressure] refusal names; the orchestrator is the one calling start_unit.
  sangsoe: /^pressure wait$/,
};
const PLAIN = new Set(["cd", "pwd", "jq", "head", "tail", "wc", "sort", "uniq", "grep", "date", "true"]);
const SHIMS = new Set(["claude-teams", "agent-teams-tmux"]);

function coordination(argv: readonly string[]): boolean {
  const [head, ...rest] = argv;
  if (!head) return true;
  if (PLAIN.has(head)) return true;
  // Decision 286: `cat` of files the Read tool would also give it, which is how a body file is sent
  // (`--body "$(cat brief.md)"`). With no file it only copies stdin somewhere. Where the output goes
  // is not read here: the parser drops redirections, for `cat` as for `head` and the rest of PLAIN.
  if (head === "cat") {
    const files = rest.filter((a) => !a.startsWith("-"));
    return files.length > 0 && files.every(readable);
  }
  // Help and version print and act on nothing, except under Orca's two team shims, which hand
  // their arguments on to another program (read from the 1.4.259 CLI).
  if (head === "orca" && !SHIMS.has(rest[0] ?? "") && rest.some((a) => a === "--help" || a === "--version")) return true;
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
// resource tools, which carry the server name instead of an mcp__ prefix. A list with no server is how
// it learns that name (the agent text names only the resource), and it reads metadata only.
const SANGSOE_SERVER = /^plugin:sangsoe:/;

function allowed(call: ToolCall): boolean {
  if (TOOLS.has(call.tool) || call.tool.startsWith("mcp__plugin_sangsoe_")) return true;
  const server = call.input.server;
  if (call.tool === "ListMcpResourcesTool") return server === undefined || SANGSOE_SERVER.test(String(server));
  if (call.tool === "ReadMcpResourceTool") return SANGSOE_SERVER.test(String(server ?? ""));
  const file = String(call.input.file_path ?? call.input.path ?? "");
  if (call.tool === "Read") return readable(file);
  if (call.tool === "Write" || call.tool === "Edit") return WRITABLE.test(file);
  if (call.tool === "Bash" || call.tool === "Monitor") {
    return parse(String(call.input.command ?? "")).commands.every((c) => coordination(unwrap(c.words).argv));
  }
  return false;
}

// Decision 300: a refusal names the way on for the shape it refused. Decision 301 added the close of a
// terminal with no Dispatch, which unit_close cannot check.
export const CLOSE_ROUTE =
  "To close a finished unit use `orca orchestration worker-release`, then the MCP tool unit_close {dispatch} if the terminal stays retained; " +
  "`worker-stop` is for a worker that must be stopped while it runs. A terminal with no Dispatch (a session started outside start_unit) " +
  "is closed by the owner in Orca: tell them its handle (decision 301). `orca terminal close` is not called directly.";
const INTERPRETERS = /^(python[\d.]*|node|deno|bun|ruby|perl|php|lua)$/;

function route(call: ToolCall): string {
  if (call.tool !== "Bash" && call.tool !== "Monitor") return "";
  const hints = new Set<string>();
  for (const c of parse(String(call.input.command ?? "")).commands) {
    const { argv } = unwrap(c.words);
    const [head = "", ...rest] = argv;
    if (coordination(argv)) continue;
    const words = rest.filter((a) => !a.startsWith("-")).join(" ");
    if (head === "orca" && words.startsWith("terminal close")) hints.add(CLOSE_ROUTE);
    else if (head === "orca" && /^terminal\s+send\b/.test(words))
      hints.add("Another session's terminal is not typed into. Answer it with `orca orchestration reply --id <message_id>` or message it with `orca orchestration send`.");
    else if (INTERPRETERS.test(head)) hints.add(`Filter JSON with \`jq\`; ${head} is not coordination.`);
    else if (head === "sangsoe" && /^(brief|todo)\b/.test(words)) hints.add("Read the status table through the resource `brief` (ReadMcpResourceTool) instead of the sangsoe command.");
    else if (head === "sed" || head === "awk") hints.add("Use `head`, `tail`, `grep` or `jq` to cut output.");
  }
  return [...hints].join(" ");
}

export const delegateGate: Gate = (call, facts) => {
  if (call.subagent || allowed(call) || facts.role() !== "orchestrator") return null;
  const way = route(call);
  return {
    decision: "deny",
    gate: "delegate",
    reason:
      `[gate:delegate] The orchestrator coordinates and does not do the work itself: this ${call.tool} call is outside ` +
      "coordination. Hand it down: start a worker with the MCP tool start_unit, or give it to a subagent (Agent). " +
      'A long message goes in a .md file written with the Write tool and sent as --body "$(cat <file>.md)".' +
      (way ? ` ${way}` : ""),
  };
};
