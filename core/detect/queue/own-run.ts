import { answerNotifiedKey, mootNotifiedKey, type NotifiedKey, type StoredEvent } from "../../contract/index.ts";
import type { ViewGate, ViewInput, ViewTask } from "../../contract/views.ts";
import { decisionAnswer } from "../../decision/answer.ts";
import { decisionMoot } from "../../decision/moot.ts";
import { isOpenGate } from "../../decision/waiters.ts";
import { foldFacts } from "../../graph/facts.ts";
import { parseNode } from "../../graph/nodes.ts";
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
const LABEL = { item_ready: "🟢 준비됨", todo_due: "📅 기한", trigger_unclear: "⚠️ trigger 불명" } as const;
type Told = keyof typeof LABEL;
const isTold = (type: string): type is Told => type in LABEL;
const closed = (t: ViewTask | undefined) => t !== undefined && (t.status === "completed" || (t.status === "failed" && t.result === "cancelled"));

/**
 * The other Runs that hold a predecessor of one of this Run's open items (an extra edge may cross
 * Runs; an Orca dep never does). Without their Tasks such an item reads "unknown", never ready.
 */
function predecessorRuns(events: readonly StoredEvent[], mine: ReadonlyMap<string, ViewTask>, run: string): string[] {
  const preds = foldFacts(events).edges.flatMap((e) => {
    const [succ, pred] = [parseNode(e.succ), parseNode(e.pred)];
    if (succ?.kind !== "item" || pred?.kind !== "item" || mine.has(pred.task)) return [];
    const waiting = mine.get(succ.task);
    return waiting && !closed(waiting) ? [pred.task] : [];
  });
  if (preds.length === 0) return [];
  const runOf = new Map(events.flatMap((e) => (e.type === "item_created" && typeof e.payload.run === "string" ? [[String(e.payload.task), e.payload.run] as const] : [])));
  return [...new Set(preds.flatMap((t) => runOf.get(t) ?? []))].filter((r) => r !== run);
}

/**
 * Decision 274: Orca refuses a send from a process with no terminal, so the plugin's timer and panel
 * cannot tell a Run anything. The session that holds the Run does that Run's part itself, from its
 * token-free UserPromptSubmit hook, with the queue-monitor's own judgment over its own Run:
 * - a decision answered or mooted elsewhere (the panel button, the timer) that a Task of this Run
 *   still waits on. A live Task's open gate is resolved by answering or mooting again with this Run
 *   as caller (Orca lets only the Run's session do it). A closed Task's gate stays open on purpose
 *   (decision 91④(ii)) and its Run is told instead: this session is that Run, so the line says it and
 *   the `notified` row is written under the key the mail would have used. Waiters of other Runs are
 *   theirs: nothing is called for a decision none of this Run's Tasks waits on;
 * - the Run's ready, due and unclear items are told in one count line. "Told" is the `notified` row
 *   under the key the timer's mail would have used, so the timer may have written the item's row
 *   first, and a round that can send does not mail it again.
 * `run` is the Run the calling session holds (the hook reads run-current once; a worker holds none and
 * never gets here). With nothing to free the cost is one task-list and one gate-list, plus one
 * task-list per other Run that holds a predecessor of this Run's open items.
 */
export async function deliverOwnRun(deps: CoreDeps, run: string, now: string): Promise<OwnRunDelivery> {
  const own = await readSnapshot(deps.orca, [run]);
  if (own.unread.length > 0) return { skipped: `task-list ${run}` };
  const listed = await deps.orca.gateList({ run });
  if (!listed.ok) return { skipped: `gate-list ${run}` };
  const events = deps.store.events();
  const mine = new Map(own.snapshot.tasks.map((t) => [t.id, t]));
  // A Run that cannot be read leaves its Tasks out: the items waiting on them stay unknown.
  const others = await readSnapshot(deps.orca, predecessorRuns(events, mine, run));
  const gates: ViewGate[] = listed.value.map((g) => ({ id: g.id, taskId: g.taskId ?? "", open: isOpenGate(g) }));
  const input: ViewInput = { orca: { tasks: [...own.snapshot.tasks, ...others.snapshot.tasks], gates }, events, now };
  const j = judgeQueue(input, DEFAULT_MONITOR_CONFIG);
  const told = new Set(events.flatMap((e) => (e.type === "notified" && e.dedupe_key ? [e.dedupe_key] : [])));
  const inject = (key: NotifiedKey) =>
    deps.store.append({ type: "notified", source: SOURCE, target: key.target, dedupe_key: key.dedupe_key, payload: { msg_id: `inject:${run}`, to: `run:${run}`, msg_type: "status" } });

  const resolved: string[] = [];
  const freed: string[] = [];
  const late: string[] = [];
  const stuck: string[] = [];
  const open = new Set(gates.filter((g) => g.open).map((g) => g.id));
  const answers = new Map(j.reanswer.map((a) => [a.decision, a]));
  for (const d of decisionView(input)) {
    const answer = answers.get(d.decision);
    const moot = d.closedReason === "moot";
    if (!moot && !answer) continue;
    const key = (task: string) => (moot ? mootNotifiedKey(d.decision, task) : answerNotifiedKey(d.decision, task));
    let live = false;
    for (const w of d.waiters) {
      const task = mine.get(w.task);
      if (!task) continue;
      const untold = !told.has(key(w.task).dedupe_key);
      if (!closed(task)) live ||= w.gate !== null ? open.has(w.gate) : !moot && task.status === "dispatched" && untold;
      // Told before the call below, so that call finds the row and mails this Run nothing.
      else if (w.gate !== null && open.has(w.gate) && untold && inject(key(w.task)).inserted) {
        late.push(answer ? `${d.decision}: ${answer.answer.replace(/\s+/g, " ")}` : `${d.decision} 무효(moot)`);
      }
    }
    if (!live) continue;
    const r = answer ? await decisionAnswer(deps, { ...answer, callerRun: run }) : await decisionMoot(deps, { decision: d.decision, evidence: { kind: "tasks_closed" }, callerRun: run });
    if (!r.ok) stuck.push(`${d.decision}(${r.refusal.code})`);
    else if (r.value.resolved.length > 0) {
      resolved.push(...r.value.resolved);
      freed.push(d.decision);
    }
  }

  const ready = readyKeys(input);
  const items: { type: Told; event: Planned; key: NotifiedKey }[] = [
    ...j.ready.flatMap((r) => {
      const key = ready.get(r.task);
      return key && mine.has(r.task) ? [{ type: "item_ready" as const, event: r.event, key }] : [];
    }),
    ...j.planned.flatMap((event) => {
      const n = leadNotice(event);
      return n && isTold(event.type) && mine.has(n.task) ? [{ type: event.type, event, key: { target: n.task, dedupe_key: n.key } }] : [];
    }),
  ];
  const fresh = items.filter((i) => !told.has(i.key.dedupe_key));
  if (fresh.length + resolved.length + late.length + stuck.length === 0) return { run, resolved, lines: [] };
  for (const i of items) deps.store.append({ ...i.event, source: SOURCE });
  for (const i of fresh) inject(i.key);
  const parts = (Object.keys(LABEL) as Told[]).map((type) => `${LABEL[type]} ${items.filter((i) => i.type === type).length}`);
  const gone = freed.length > 0 ? ` 닫힌 결정 ${freed.join(" · ")} 의 게이트 ${resolved.length}개를 풀었다.` : "";
  const heard = late.length > 0 ? ` 닫힌 Task 가 기다리던 결정: ${late.join(" · ")}.` : "";
  const left = stuck.length > 0 ? ` 풀다 만 결정: ${stuck.join(" · ")}. 이 Run 의 게이트가 남았으면 다음 프롬프트에 다시 푼다.` : "";
  return { run, resolved, lines: [`sangsoe: Run ${run} — ${parts.join(" · ")} (새로 ${fresh.length}건). 목록은 resource ready 와 brief 로 읽는다.${gone}${heard}${left}`] };
}
