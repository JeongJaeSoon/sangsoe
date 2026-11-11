import { option, parse, unwrap } from "./shell.ts";
import type { Gate, Verdict } from "./types.ts";

// Decision 212 ④: a role session's own `orca orchestration task-update --status completed` is the third
// close point (after pr-monitor's close and the panel's 완료). done_blockers refuses it while the item
// may not go to ✅; a person's own session (role general) is left alone, as self-land leaves it.

function verdict(reason: string): Verdict {
  return { decision: "deny", gate: "done-blockers", reason: `[gate:done-blockers] ${reason}` };
}

export const doneBlockersGate: Gate = (call, facts) => {
  if (call.tool !== "Bash") return null;
  for (const cmd of parse(String(call.input.command ?? "")).commands) {
    const { argv } = unwrap(cmd.words);
    const pos = argv.filter((a) => !a.startsWith("-"));
    const close = argv[0] === "orca" && pos[1] === "orchestration" && pos[2] === "task-update" && option(argv, "--status") === "completed";
    if (!close || facts.role() === "general") continue;
    const task = option(argv, "--id");
    if (!task) continue;
    const blockers = facts.doneBlockers(task, option(argv, "--run"));
    if (blockers === undefined) {
      return verdict(`${task} 의 완료 조건(done_blockers)을 읽지 못해(저장소나 Orca task-list) 닫을 수 있는지 확인할 수 없다. 다시 시도하거나 리드에게 알린다.`);
    }
    if (blockers.length > 0) return verdict(`${task} 는 아직 ✅ 로 닫을 수 없다: ${blockers.join(" · ")}`);
  }
  return null;
};
