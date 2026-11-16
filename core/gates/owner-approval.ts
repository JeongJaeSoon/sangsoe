import { APPROVAL_SHAPE } from "../owner/approval.ts";
import { parse, unwrap } from "./shell.ts";
import type { Gate, Verdict } from "./types.ts";

// Decision 311: the owner's approval line counts only when the owner types it. This gate refuses, for
// every role, the shapes a session could use to put it into a prompt itself: a tool that submits a
// prompt later, a Bash command whose text holds the line (a nested session, a send into a terminal,
// a heredoc), or the prompt hook fed by hand. The hook checks again (a scheduled line, a driven one);
// a line a command builds from a file or a variable is outside both (decision 158 N10).

const SCHEDULERS = new Set(["ScheduleWakeup", "CronCreate"]);
// A lead passing the line up to the orchestrator, the body written out with `cat`, is how it reaches the owner.
const CARRIES = /^(?:orca orchestration (?:send|reply|ask)|cat)$/;
const PLAIN = /^[\w.@+-]+(?: [\w.@+-]+){0,2}$/;

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
  // The raw text: the parser drops heredoc bodies, and a heredoc can carry the line too.
  const text = String(call.input.command ?? "");
  const simple = parse(text).commands;
  const commands = simple.map((c) => unwrap(c.words).argv);
  if (commands.some((argv) => argv.some((w, i) => w === "hook" && argv[i + 1] === "user-prompt-submit"))) return deny("Only Claude Code calls the prompt hook");
  if (!APPROVAL_SHAPE.test(text)) return null;
  const heads = commands.map((argv) => argv.slice(0, argv[0] === "orca" ? 3 : 1).join(" "));
  const others = [
    ...new Set(heads.flatMap((h, i) => (CARRIES.test(h) ? [] : [name(h, simple[i]?.words[0] ?? "")]))),
  ];
  if (others.length === 0) return null;
  return deny(
    `This command carries the owner's approval line somewhere other than a message to a session: ${others.join(", ")} ${others.length === 1 ? "is" : "are"} not a message to a session. ` +
      "Pass the line up with `orca orchestration send|reply|ask` alone, with no pipe or redirection",
  );
};

/** A command by its first words when they are plain words, so the line or a piece of it is never echoed (decision 327). */
function name(head: string, first: string): string {
  if (head === "") return /^\w+=/.test(first) ? "a variable assignment" : "a command";
  return PLAIN.test(head) ? `\`${head}\`` : "a command";
}
