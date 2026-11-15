import type { ViewGate, ViewInput } from "../../contract/views.ts";
import { decisionAnswer } from "../../decision/answer.ts";
import { isOpenGate } from "../../decision/waiters.ts";
import { readSnapshot } from "../../graph/snapshot.ts";
import type { CoreDeps } from "../../notify/result.ts";
import { DEFAULT_MONITOR_CONFIG } from "../monitor.ts";
import { judgeQueue } from "./judge.ts";

export type OwnRunDelivery =
  | { readonly skipped: string }
  | {
      readonly run: string;
      /** Gates of answered decisions this call resolved. */
      readonly resolved: readonly string[];
      /** What to print into the session, at most one line; empty when nothing is new. */
      readonly lines: readonly string[];
    };

/**
 * Decision 274: Orca refuses a send from a process with no terminal, so the plugin's timer and panel
 * cannot tell a Run anything. The session that holds the Run does that Run's part itself, from its
 * token-free UserPromptSubmit hook, with the queue-monitor's own judgment over its own Run:
 * - a decision answered elsewhere (the panel button) whose waiter still waits on this Run is answered
 *   again with this Run as caller, which resolves the gate (Orca lets only the Run's session do it);
 * - the Run's ready, due and unclear items are written as their rows and told in one count line,
 *   only when a row is new or a gate was resolved (the rows' own keys make it once per transition).
 * `run` is the Run the calling session holds (the hook reads run-current once; a worker holds none and
 * never gets here). The cost is one task-list and one gate-list.
 */
export async function deliverOwnRun(deps: CoreDeps, run: string, now: string): Promise<OwnRunDelivery> {
  const snap = await readSnapshot(deps.orca, [run]);
  if (snap.unread.length > 0) return { skipped: `task-list ${run}` };
  const listed = await deps.orca.gateList({ run });
  if (!listed.ok) return { skipped: `gate-list ${run}` };
  const gates: ViewGate[] = listed.value.map((g) => ({ id: g.id, taskId: g.taskId ?? "", open: isOpenGate(g) }));
  const input: ViewInput = { orca: { tasks: snap.snapshot.tasks, gates }, events: deps.store.events(), now };
  const j = judgeQueue(input, DEFAULT_MONITOR_CONFIG);

  const resolved: string[] = [];
  const answered: string[] = [];
  for (const a of j.reanswer) {
    const r = await decisionAnswer(deps, { ...a, callerRun: run });
    if (r.ok && r.value.resolved.length > 0) {
      resolved.push(...r.value.resolved);
      answered.push(a.decision);
    }
  }

  const rows = [...j.ready.map((r) => r.event), ...j.planned.filter((e) => e.type === "todo_due" || e.type === "trigger_unclear")];
  const fresh = rows.filter((e) => deps.store.append(e).inserted).length;
  if (fresh === 0 && resolved.length === 0) return { run, resolved, lines: [] };
  const count = (type: string) => rows.filter((e) => e.type === type).length;
  const parts = [`🟢 준비됨 ${count("item_ready")}`, `📅 기한 ${count("todo_due")}`, `⚠️ trigger 불명 ${count("trigger_unclear")}`];
  const told = answered.length > 0 ? ` 답이 달린 결정 ${answered.join(" · ")} 의 게이트 ${resolved.length}개를 풀었다.` : "";
  return { run, resolved, lines: [`sangsoe: Run ${run} — ${parts.join(" · ")} (새로 ${fresh}건). 목록은 resource ready 와 brief 로 읽는다.${told}`] };
}
