import { parse, unwrap } from "./shell.ts";
import type { Gate } from "./types.ts";

// Appendix #gates [gate:sleep-loop]: only a foreground loop that sleeps. The Monitor tool and a Bash run
// with run_in_background are the normal ways to wait and are never seen here (#460).

export const sleepLoop: Gate = (call) => {
  if (call.tool !== "Bash" || call.input.run_in_background === true) return null;
  const parsed = parse(String(call.input.command ?? ""));
  if (!parsed.loops || !parsed.commands.some((c) => unwrap(c.words).argv[0] === "sleep")) return null;
  return {
    decision: "deny",
    gate: "sleep-loop",
    reason:
      "[gate:sleep-loop] A foreground sleep loop holds the turn. Run the same command with run_in_background: true " +
      "(its completion wakes you), or wait for an Orca message with `orca orchestration check --wait`.",
  };
};
