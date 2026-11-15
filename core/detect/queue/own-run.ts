import { answerNotifiedKey, mootNotifiedKey, type NotifiedKey, type StoredEvent } from "../../contract/index.ts";
import type { TaskRow } from "../../contract/orca.ts";
import type { ViewGate, ViewInput } from "../../contract/views.ts";
import { decisionAnswer } from "../../decision/answer.ts";
import { decisionMoot } from "../../decision/moot.ts";
import { decisionStates, isClosedTask, isOpenGate, owed } from "../../decision/waiters.ts";
import { foldFacts } from "../../graph/facts.ts";
import { parseNode } from "../../graph/nodes.ts";
import { readyKeys } from "../../graph/notify-ready.ts";
import { type FullTaskRow, readSnapshot, snapshotTasks } from "../../graph/snapshot.ts";
import type { CoreDeps } from "../../notify/result.ts";
import { DEFAULT_MONITOR_CONFIG, type Planned } from "../monitor.ts";
import { judgeQueue } from "./judge.ts";
import { leadNotice } from "./round.ts";

export type OwnRunDelivery =
  | { readonly skipped: string }
  | {
      readonly run: string;
      /** Gates of closed decisions that Orca shows resolved after this call's re-calls. */
      readonly resolved: readonly string[];
      /** What to print into the session, at most one line; empty when nothing is new. */
      readonly lines: readonly string[];
    };

const SOURCE = "UserPromptSubmit";
const LABEL = { item_ready: "🟢 준비됨", todo_due: "📅 기한", trigger_unclear: "⚠️ trigger 불명" } as const;
type Told = keyof typeof LABEL;
const isTold = (type: string): type is Told => type in LABEL;
const LINKED_BY = new Set(["hook", "button", "orchestrator", "observed"]);

/**
 * The other Runs that hold a predecessor of one of this Run's open items (an extra edge may cross
 * Runs; an Orca dep never does). Without their Tasks such an item reads "unknown", never ready.
 */
function predecessorRuns(events: readonly StoredEvent[], mine: ReadonlyMap<string, TaskRow>, run: string): string[] {
  const preds = foldFacts(events).edges.flatMap((e) => {
    const [succ, pred] = [parseNode(e.succ), parseNode(e.pred)];
    if (succ?.kind !== "item" || pred?.kind !== "item" || mine.has(pred.task)) return [];
    const waiting = mine.get(succ.task);
    return waiting && !isClosedTask(waiting) ? [pred.task] : [];
  });
  if (preds.length === 0) return [];
  const runOf = new Map(events.flatMap((e) => (e.type === "item_created" && typeof e.payload.run === "string" ? [[String(e.payload.task), e.payload.run] as const] : [])));
  return [...new Set(preds.flatMap((t) => runOf.get(t) ?? []))].filter((r) => r !== run);
}

/**
 * Decision 274: Orca refuses a send from a process with no terminal, so the plugin's timer and panel
 * cannot tell a Run anything. The session that holds the Run does that Run's part itself, from its
 * token-free UserPromptSubmit hook:
 * - a decision answered or mooted elsewhere (the panel button, the timer). For each waiter whose Task
 *   is in this Run, what is still owed is read by the same `owed` that `release` uses. A closed Task's
 *   Run is told: this session is that Run, so the line says it and the `notified` row is written under
 *   the key the mail would have used. An open gate to resolve or a running worker to tell is one
 *   re-call of decision_answer or decision_moot with this Run as caller (Orca lets only the Run's
 *   session resolve its gates). Nothing owed is no call. Waiters of other Runs are theirs;
 * - the Run's ready, due and unclear items are told in one count line. "Told" is the `notified` row
 *   under the key the timer's mail would have used, so the timer may have written the item's row
 *   first, and a round that can send does not mail it again.
 * `run` is the Run the calling session holds (the hook reads run-current once; a worker holds none and
 * never gets here). With nothing owed the cost is one task-list and one gate-list, plus one task-list
 * per other Run that holds a predecessor of this Run's open items. A re-call that Orca keeps refusing
 * (a worker that cannot be reached) is made again on each prompt and prints nothing.
 */
export async function deliverOwnRun(deps: CoreDeps, run: string, now: string): Promise<OwnRunDelivery> {
  const listedTasks = await deps.orca.taskList({ run, full: true });
  if (!listedTasks.ok) return { skipped: `task-list ${run}` };
  const listed = await deps.orca.gateList({ run });
  if (!listed.ok) return { skipped: `gate-list ${run}` };
  const events = deps.store.events();
  const mine = new Map(listedTasks.value.map((t) => [t.id, t]));
  // A Run that cannot be read leaves its Tasks out: the items waiting on them stay unknown.
  const others = await readSnapshot(deps.orca, predecessorRuns(events, mine, run));
  const gates: ViewGate[] = listed.value.map((g) => ({ id: g.id, taskId: g.taskId ?? "", open: isOpenGate(g) }));
  const tasks = [...snapshotTasks(listedTasks.value as FullTaskRow[], run), ...others.snapshot.tasks];
  const input: ViewInput = { orca: { tasks, gates }, events, now };
  const told = new Set(events.flatMap((e) => (e.type === "notified" && e.dedupe_key ? [e.dedupe_key] : [])));
  const inject = (key: NotifiedKey) =>
    deps.store.append({ type: "notified", source: SOURCE, target: key.target, dedupe_key: key.dedupe_key, payload: { msg_id: `inject:${run}`, to: `run:${run}`, msg_type: "status" } });

  const open = new Set(gates.filter((g) => g.open).map((g) => g.id));
  const answered = new Map(events.flatMap((e) => (e.type === "decision_answered" && e.payload.late !== true ? [[String(e.payload.decision), e.payload] as const] : [])));
  const late: string[] = [];
  /** Decision → the gates of this Run's waiters that were open when a re-call was made for it. */
  const recalled = new Map<string, string[]>();
  for (const { row, waiters } of decisionStates(events)) {
    const moot = row.closedReason === "moot";
    if (!moot && row.state !== "answered" && row.closedReason !== "answered") continue;
    const d = row.decision;
    const key = (task: string) => (moot ? mootNotifiedKey(d, task) : answerNotifiedKey(d, task));
    const mineOpen: string[] = [];
    let recall = false;
    for (const w of waiters) {
      const task = mine.get(w.task);
      if (!task) continue;
      const due = owed(w, task, w.gate !== null && open.has(w.gate));
      if (due.gate) mineOpen.push(due.gate);
      if (!due.tell || told.has(key(w.task).dedupe_key)) continue;
      if (due.tell === "worker") recall = true;
      // Written before the re-call below, so that call finds the row and mails this Run nothing.
      else if (inject(key(w.task)).inserted) late.push(moot ? `${d} 무효(moot)` : `${d}: ${(row.answer ?? "").replace(/\s+/g, " ")}`);
    }
    if (!recall && mineOpen.length === 0) continue;
    const a = answered.get(d);
    const linkedBy = String(a?.linked_by ?? "");
    if (moot) await decisionMoot(deps, { decision: d, evidence: { kind: "tasks_closed" }, callerRun: run });
    else if (a && typeof a.owner_action === "number" && LINKED_BY.has(linkedBy)) {
      await decisionAnswer(deps, { decision: d, ownerAction: a.owner_action, answer: String(a.answer ?? ""), linkedBy: linkedBy as "hook" | "button" | "orchestrator" | "observed", callerRun: run });
    } else continue;
    recalled.set(d, mineOpen);
  }
  // What the re-calls resolved is read back from Orca: a call that ended incomplete may still have resolved this Run's gate.
  const resolved: string[] = [];
  const freed: string[] = [];
  if ([...recalled.values()].some((g) => g.length > 0)) {
    const after = await deps.orca.gateList({ run });
    const still = new Set(after.ok ? after.value.filter(isOpenGate).map((g) => g.id) : open);
    for (const [d, was] of recalled) {
      const gone = was.filter((g) => !still.has(g));
      if (gone.length > 0) freed.push(d);
      resolved.push(...gone);
    }
  }

  const j = judgeQueue(input, DEFAULT_MONITOR_CONFIG);
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
  if (fresh.length + resolved.length + late.length === 0) return { run, resolved, lines: [] };
  for (const i of items) deps.store.append({ ...i.event, source: SOURCE });
  for (const i of fresh) inject(i.key);
  const parts = (Object.keys(LABEL) as Told[]).map((type) => `${LABEL[type]} ${items.filter((i) => i.type === type).length}`);
  const gone = freed.length > 0 ? ` 닫힌 결정 ${freed.join(" · ")} 의 게이트 ${resolved.length}개를 풀었다.` : "";
  const heard = late.length > 0 ? ` 닫힌 Task 가 기다리던 결정: ${late.join(" · ")}.` : "";
  return { run, resolved, lines: [`sangsoe: Run ${run} — ${parts.join(" · ")} (새로 ${fresh.length}건). 목록은 resource ready 와 brief 로 읽는다.${gone}${heard}`] };
}
