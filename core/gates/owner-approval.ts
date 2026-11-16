import { APPROVAL_SHAPE } from "../owner/approval.ts";
import { parse, unwrap } from "./shell.ts";
import type { Gate, Verdict } from "./types.ts";

// Decision 311: the owner's approval line counts only when the owner types it. This gate refuses, for
// every role, the shapes a session could use to put it into a prompt itself: a tool that submits a
// prompt later, a send into a terminal, or the prompt hook fed by hand. The hook checks again (a
// scheduled line, a driven one); a script a session writes and runs is outside both (decision 158 N10).

const SCHEDULERS = new Set(["ScheduleWakeup", "CronCreate"]);

const deny = (what: string): Verdict => ({
  decision: "deny",
  gate: "owner-approval",
  reason:
    `[gate:owner-approval] ${what}. The owner types \`승인 <owner/repo>#<N> <head>\` in the orchestrator's chat themselves; ` +
    "show them the line from land's note and wait for it (decision 311).",
});

export const ownerApprovalGate: Gate = (call) => {
  if (SCHEDULERS.has(call.tool)) {
    return APPROVAL_SHAPE.test(String(call.input.prompt ?? "")) ? deny(`${call.tool} would submit the owner's approval line as a prompt`) : null;
  }
  if (call.tool !== "Bash") return null;
  for (const cmd of parse(String(call.input.command ?? "")).commands) {
    const { argv } = unwrap(cmd.words);
    if (argv.some((w, i) => w === "hook" && argv[i + 1] === "user-prompt-submit")) return deny("Only Claude Code calls the prompt hook");
    if (argv[0] === "orca" && argv[1] === "terminal" && argv[2] === "send" && APPROVAL_SHAPE.test(argv.join(" "))) {
      return deny("A terminal send would type the owner's approval line for them");
    }
  }
  return null;
};
