import { option, parse, unwrap } from "./shell.ts";
import type { Gate, Verdict } from "./types.ts";

// Decision 80 N8: `send --to` also takes a terminal handle, which changes on every restart; a report sent
// to a terminal that is gone looks delivered and is lost. Shape check, recorded as gate_denied.

const HANDLE = /^term_[\w-]+$/;
// A brief handed to start_unit that tells the worker to report to a handle.
const BRIEF_HANDLE = /(?:--to[=\s]+|\bREPORT\b[^\n]*?)term_[\w-]+/;

const deny = (where: string): Verdict => ({
  decision: "deny",
  gate: "report-address",
  reason:
    `[gate:report-address] ${where} reports to a term_ handle. ` +
    "Address a Run or a Dispatch instead (--to run:<id> or --to dispatch:<id>), or leave --to out so Orca " +
    "uses the Dispatch's Run: a handle changes on every restart and a report to a closed terminal is lost (decision 80 N8).",
});

export const reportAddress: Gate = (call) => {
  if (call.tool === "Bash") {
    for (const cmd of parse(String(call.input.command ?? "")).commands) {
      const { argv } = unwrap(cmd.words);
      if (argv[0] !== "orca" || argv[1] !== "orchestration") continue;
      const to = option(argv, "--to");
      if (to && HANDLE.test(to)) return deny("This message");
    }
    return null;
  }
  if (call.tool.endsWith("__start_unit") && BRIEF_HANDLE.test(String(call.input.spec ?? ""))) {
    return deny("The brief");
  }
  return null;
};
