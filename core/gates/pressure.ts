import { parse, unwrap } from "./shell.ts";
import type { Gate, ToolCall } from "./types.ts";

// Appendix #gates [gate:pressure]: a heavy start waits while the machine is loaded. The load judgment is
// core/capacity's one function (decision 83); this gate only decides what counts as heavy.

function heavy(call: ToolCall): string | undefined {
  if (call.tool.endsWith("__start_unit")) return "starting a worker";
  if (call.tool !== "Bash") return undefined;
  for (const cmd of parse(String(call.input.command ?? "")).commands) {
    const { argv } = unwrap(cmd.words);
    const pos = argv.filter((a) => !a.startsWith("-"));
    if (argv[0] === "docker" && pos[1] === "compose" && pos.includes("up")) return "a compose stack";
    if (argv[0] === "docker-compose" && pos.includes("up")) return "a compose stack";
    if (argv[0] === "orca" && pos[1] === "worktree" && pos[2] === "create") return "a new worktree";
  }
  return undefined;
}

export const pressureGate: Gate = (call, facts) => {
  const what = heavy(call);
  if (!what) return null;
  const load = facts.load();
  if (load.level === "ok") return null;
  const why = load.reasons.length > 0 ? `: ${load.reasons.join(", ")}` : "";
  return {
    decision: "deny",
    gate: "pressure",
    reason:
      `[gate:pressure] The machine is at ${load.level}${why}, so ${what} waits. ` +
      "Nothing was queued: run the same call again once the load drops. To be woken then, start `sangsoe pressure wait` " +
      "with run_in_background: true; when it finishes with \"The load dropped\", run the same call once. If a `sangsoe pressure wait` is already " +
      "running in this session, do not start another. If you run the call again before it finishes, stop that wait. " +
      "Do other work meanwhile.",
  };
};
