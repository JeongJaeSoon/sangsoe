import type { NotifiedKey } from "../../contract/index.ts";
import type { ViewGate, ViewInput } from "../../contract/views.ts";
import { decisionAnswer } from "../../decision/answer.ts";
import { decisionMoot } from "../../decision/moot.ts";
import { isOpenGate } from "../../decision/waiters.ts";
import { readyKeys } from "../../graph/notify-ready.ts";
import { readSnapshot } from "../../graph/snapshot.ts";
import type { CoreDeps } from "../../notify/result.ts";
import { decision as decisionView } from "../../store/views/decision.ts";
import { DEFAULT_MONITOR_CONFIG, type Planned } from "../monitor.ts";
import { judgeQueue } from "./judge.ts";
import { leadNotice } from "./round.ts";

export type OwnRunDelivery =
  | { readonly skipped: string }
  | {
      readonly run: string;
      /** Gates of closed decisions this call resolved. */
      readonly resolved: readonly string[];
      /** What to print into the session, at most one line; empty when nothing is new. */
      readonly lines: readonly string[];
    };

const SOURCE = "UserPromptSubmit";
const LABEL: Record<string, string> = { item_ready: "🟢 준비됨", todo_due: "📅 기한", trigger_unclear: "⚠️ trigger 불명", escalation_stale: "🔍 확인 안 됨" };

/**
 * Decision 274: Orca refuses a send from a process with no terminal, so the plugin's timer and panel
 * cannot tell a Run anything. The session that holds the Run does that Run's part itself, from its
 * token-free UserPromptSubmit hook, with the queue-monitor's own judgment over its own Run:
 * - a decision answered or mooted elsewhere (the panel button, the timer) whose waiter still waits on
 *   this Run is answered or mooted again with this Run as caller, which resolves the gate (Orca lets
 *   only the Run's session do it);
 * - the Run's ready items and the rows the timer would mail its lead about (due, unclear, unverified)
 *   are told in one count line. "Told" is the `notified` row under the key the mail would have used,
 *   so the timer may have written the item's row first, and a round that can send does not mail it again.
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
  const freed: string[] = [];
  const took = (decision: string, gatesNow: readonly string[]) => {
    if (gatesNow.length === 0) return;
    resolved.push(...gatesNow);
    freed.push(decision);
  };
  for (const a of j.reanswer) {
    const r = await decisionAnswer(deps, { ...a, callerRun: run });
    if (r.ok) took(a.decision, r.value.resolved);
  }
  // A decision the timer closed as moot keeps its gate open here: the same call again resumes the release.
  const open = new Set(gates.filter((g) => g.open).map((g) => g.id));
  for (const d of decisionView(input)) {
    if (d.closedReason !== "moot" || !d.waiters.some((w) => w.gate !== null && open.has(w.gate))) continue;
    const r = await decisionMoot(deps, { decision: d.decision, evidence: { kind: "tasks_closed" }, callerRun: run });
    if (r.ok) took(d.decision, r.value.resolved);
  }

  const ready = readyKeys(input);
  const items: { event: Planned; key: NotifiedKey }[] = [
    ...j.ready.flatMap((r) => {
      const key = ready.get(r.task);
      return key ? [{ event: r.event, key }] : [];
    }),
    ...j.planned.flatMap((event) => {
      const n = leadNotice(event);
      return n ? [{ event, key: { target: n.task, dedupe_key: n.key } }] : [];
    }),
  ];
  const told = new Set(input.events.flatMap((e) => (e.type === "notified" && e.dedupe_key ? [e.dedupe_key] : [])));
  const fresh = items.filter((i) => !told.has(i.key.dedupe_key));
  if (fresh.length === 0 && resolved.length === 0) return { run, resolved, lines: [] };
  for (const i of items) deps.store.append({ ...i.event, source: SOURCE });
  for (const i of fresh) {
    deps.store.append({ type: "notified", source: SOURCE, target: i.key.target, dedupe_key: i.key.dedupe_key, payload: { msg_id: `inject:${run}`, to: `run:${run}`, msg_type: "status" } });
  }
  const count = (type: string) => items.filter((i) => i.event.type === type).length;
  const parts = Object.entries(LABEL).flatMap(([type, label]) => (type === "escalation_stale" && count(type) === 0 ? [] : [`${label} ${count(type)}`]));
  const gone = freed.length > 0 ? ` 닫힌 결정 ${freed.join(" · ")} 의 게이트 ${resolved.length}개를 풀었다.` : "";
  return { run, resolved, lines: [`sangsoe: Run ${run} — ${parts.join(" · ")} (새로 ${fresh.length}건). 목록은 resource ready 와 brief 로 읽는다.${gone}`] };
}
