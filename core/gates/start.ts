import { againstCwd, has, type Parsed, parse, scriptPath, unwrap } from "./shell.ts";
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
  holder: "a claude session held by a terminal multiplexer, at/batch or launchd",
} as const;

// Tools that keep a command running after this shell: tmux and screen when they open or feed a pane,
// at/batch, launchctl. Plain use of them (a dev server in tmux, `screen -ls`) passes.
const TMUX_RUN = new Set(["new-session", "new", "new-window", "neww", "split-window", "splitw", "respawn-pane", "respawnp", "respawn-window", "respawnw", "send-keys", "send"]);
const LAUNCHCTL_RUN = new Set(["submit", "load", "bootstrap"]);
const CLAUDE_WORD = /(?:^|[\s/;&|("'>])claude(?:\s|$|["'<])/;

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
// `-h` counts as a help flag only where it is not the value of the option before it (`--prompt -h`).
const asksHelp = (argv: readonly string[]) =>
  has(argv, "--help") || argv.some((a, i) => i > 0 && a === "-h" && !(argv[i - 1] ?? "").startsWith("-"));

/** Whether argv opens a claude session (not a tool subcommand or a version check). */
function startsClaude(argv: readonly string[]): boolean {
  const [p0] = positionals(argv);
  return argv[0] === "claude" && !(p0 && CLAUDE_TOOLS.has(p0)) && !has(argv, "--version") && !has(argv, "-v");
}

/** Whether shell text starts a claude session. */
function runsClaude(text: string): boolean {
  return parse(text).commands.some((c) => startsClaude(unwrap(c.words).argv));
}

/** tmux takes several commands in one call: an argument ending in `;` ends one (`\;` there is a literal). */
function tmuxCommands(words: readonly string[]): string[][] {
  const out: string[][] = [[]];
  for (const w of words) {
    if (w.endsWith(";") && !w.endsWith("\\;")) {
      if (w.length > 1) out.at(-1)?.push(w.slice(0, -1));
      out.push([]);
    } else out.at(-1)?.push(w);
  }
  return out;
}

// Key names that end a typed line.
const ENTER_KEYS = new Set(["Enter", "C-m", "KPEnter", "C-j"]);

function tmuxRunsClaude([sub, ...args]: string[]): boolean {
  if (!sub || !TMUX_RUN.has(sub)) return false;
  if (sub === "send-keys" || sub === "send") {
    const keys = operands(args, TMUX_KEYS_VALUED).rest;
    // tmux types a trailing `\;` as a plain `;`.
    return runsClaude(keys.map((k) => (ENTER_KEYS.has(k) ? "\n" : k.replace(/\\;$/, ";"))).join(" "));
  }
  return runsClaude(operands(args, TMUX_VALUED).rest.join(" "));
}

/** Splits flags from operands; a flag cluster whose last letter is in `valued` takes the next word. */
function operands(args: readonly string[], valued: string): { rest: string[]; values: Map<string, string> } {
  const values = new Map<string, string>();
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--") {
      i++;
      break;
    }
    if (!/^-\w+$/.test(a)) break;
    const last = a.slice(-1);
    const next = args[i + 1];
    if (valued.includes(last) && next !== undefined && !next.startsWith("-")) {
      values.set(last, next);
      i++;
    }
  }
  return { rest: args.slice(i), values };
}

// tmux's global options before the subcommand; `-c` there is a shell command.
const TMUX_GLOBAL = "LSfTc";
const TMUX_VALUED = "ceFflnpstxy";
const TMUX_KEYS_VALUED = "tN";
const SCREEN_VALUED = "SrxdDXcpTehs";

function heldStart(parsed: Parsed, text: string, read: (path: string) => string | undefined): boolean {
  for (const cmd of parsed.commands) {
    const { argv } = unwrap(cmd.words);
    const [head, ...args] = argv;
    if (head === "tmux") {
      const global = operands(args, TMUX_GLOBAL);
      if (runsClaude(global.values.get("c") ?? "")) return true;
      if (tmuxCommands(global.rest).some(tmuxRunsClaude)) return true;
    }
    if (head === "screen") {
      const { rest, values } = operands(args, SCREEN_VALUED);
      // `-X stuff <text>` types text into a window, with or without other flags between.
      const typed = values.get("X") === "stuff" ? rest : rest[0] === "stuff" ? rest.slice(1) : rest;
      if (runsClaude(typed.join(" "))) return true;
    }
    if (head === "at" || head === "batch") {
      const file = operands(args, "fqmMt").values.get("f");
      if (file !== undefined && runsClaude(read(file) ?? "")) return true;
      // The job arrives on stdin (a pipe, a heredoc, a here-string): claude named anywhere in the call
      // but not started by it in the foreground goes to the job.
      if (CLAUDE_WORD.test(text) && !parsed.commands.some((c) => startsClaude(unwrap(c.words).argv))) return true;
    }
    if (head === "launchctl" && args[0] && LAUNCHCTL_RUN.has(args[0])) {
      const submit = operands(args.slice(1), "lpoe");
      if (runsClaude(submit.rest.join(" ")) || unwrap([submit.values.get("p") ?? ""]).argv[0] === "claude") return true;
      if (args.some((a) => a.endsWith(".plist") && CLAUDE_WORD.test(read(a) ?? ""))) return true;
    }
  }
  return false;
}

function rawStart(parsed: Parsed, toolBackground: boolean): string | undefined {
  for (const cmd of parsed.commands) {
    const a = unwrap(cmd.words);
    const [head] = a.argv;
    if (asksHelp(a.argv)) continue;
    const [p0, p1] = positionals(a.argv);
    if (head === "orca") {
      if (p0 === "agent" && p1 === "launch") return KIND.fallback;
      if (p0 === "worktree" && p1 === "create" && (has(a.argv, "--prompt") || has(a.argv, "--agent"))) return KIND.worktree;
      if (p0 === "orchestration" && p1 === "dispatch") return KIND.dispatch;
      if (p0 === "orchestration" && p1 === "worker-start") return KIND.workerStart;
    }
    if (head === "claude" && (cmd.background || cmd.detached || a.detached || toolBackground)) {
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
  const read = (path: string) => facts.readScript(againstCwd(call.cwd, path));
  let kind = rawStart(parsed, background) ?? (heldStart(parsed, text, read) ? KIND.holder : undefined);
  if (!kind) {
    // A start wrapped in a script file is the same start (R-10): read each script once, no deeper.
    for (const cmd of parsed.commands) {
      const path = scriptPath(unwrap(cmd.words));
      if (!path) continue;
      const script = read(path);
      const detached = background || cmd.background || cmd.detached || unwrap(cmd.words).detached;
      const inner = script === undefined ? undefined : rawStart(parse(script), detached);
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
