import type { NotifiedKey, StoredEvent } from "../../contract/index.ts";
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
 * The other Runs that hold a predecessor of one of this Run's items (an extra edge may cross Runs;
 * an Orca dep never does). Without their Tasks such an item reads "unknown", never ready.
 */
function predecessorRuns(events: readonly StoredEvent[], mine: ReadonlySet<string>, run: string): string[] {
  const preds = foldFacts(events).edges.flatMap((e) => {
    const [succ, pred] = [parseNode(e.succ), parseNode(e.pred)];
    return succ?.kind === "item" && mine.has(succ.task) && pred?.kind === "item" && !mine.has(pred.task) ? [pred.task] : [];
  });
  if (preds.length === 0) return [];
  const runOf = new Map(events.flatMap((e) => (e.type === "item_created" && typeof e.payload.run === "string" ? [[String(e.payload.task), e.payload.run] as const] : [])));
  return [...new Set(preds.flatMap((t) => runOf.get(t) ?? []))].filter((r) => r !== run);
}

/**
 * Decision 274: Orca refuses a send from a process with no terminal, so the plugin's timer and panel
 * cannot tell a Run anything. The session that holds the Run does that Run's part itself, from its
 * token-free UserPromptSubmit hook, with the queue-monitor's own judgment over its own Run:
 * - a decision answered or mooted elsewhere (the panel button, the timer) whose live waiter still
 *   waits on this Run is answered or mooted again with this Run as caller, which resolves the gate
 *   (Orca lets only the Run's session do it). A closed Task's gate stays open on purpose and is left;
 * - the Run's ready, due and unclear items are told in one count line. "Told" is the `notified` row
 *   under the key the timer's mail would have used, so the timer may have written the item's row
 *   first, and a round that can send does not mail it again.
 * `run` is the Run the calling session holds (the hook reads run-current once; a worker holds none and
 * never gets here). The cost is one task-list and one gate-list, plus one task-list per other Run
 * that holds a predecessor of this Run's items.
 */
export async function deliverOwnRun(deps: CoreDeps, run: string, now: string): Promise<OwnRunDelivery> {
  const own = await readSnapshot(deps.orca, [run]);
  if (own.unread.length > 0) return { skipped: `task-list ${run}` };
  const listed = await deps.orca.gateList({ run });
  if (!listed.ok) return { skipped: `gate-list ${run}` };
  const events = deps.store.events();
  const mine = new Map(own.snapshot.tasks.map((t) => [t.id, t]));
  // A Run that cannot be read leaves its Tasks out: the items waiting on them stay unknown.
  const others = await readSnapshot(deps.orca, predecessorRuns(events, new Set(mine.keys()), run));
  const gates: ViewGate[] = listed.value.map((g) => ({ id: g.id, taskId: g.taskId ?? "", open: isOpenGate(g) }));
  const input: ViewInput = { orca: { tasks: [...own.snapshot.tasks, ...others.snapshot.tasks], gates }, events, now };
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
  // A decision the timer closed as moot keeps a live waiter's gate open here: the same call again resumes the release.
  const open = new Set(gates.filter((g) => g.open).map((g) => g.id));
  for (const d of decisionView(input)) {
    if (d.closedReason !== "moot" || !d.waiters.some((w) => w.gate !== null && open.has(w.gate) && mine.has(w.task) && !closed(mine.get(w.task)))) continue;
    const r = await decisionMoot(deps, { decision: d.decision, evidence: { kind: "tasks_closed" }, callerRun: run });
    if (r.ok) took(d.decision, r.value.resolved);
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
  const told = new Set(events.flatMap((e) => (e.type === "notified" && e.dedupe_key ? [e.dedupe_key] : [])));
  const fresh = items.filter((i) => !told.has(i.key.dedupe_key));
  if (fresh.length === 0 && resolved.length === 0) return { run, resolved, lines: [] };
  for (const i of items) deps.store.append({ ...i.event, source: SOURCE });
  for (const i of fresh) {
    deps.store.append({ type: "notified", source: SOURCE, target: i.key.target, dedupe_key: i.key.dedupe_key, payload: { msg_id: `inject:${run}`, to: `run:${run}`, msg_type: "status" } });
  }
  const parts = (Object.keys(LABEL) as Told[]).map((type) => `${LABEL[type]} ${items.filter((i) => i.type === type).length}`);
  const gone = freed.length > 0 ? ` 닫힌 결정 ${freed.join(" · ")} 의 게이트 ${resolved.length}개를 풀었다.` : "";
  return { run, resolved, lines: [`sangsoe: Run ${run} — ${parts.join(" · ")} (새로 ${fresh.length}건). 목록은 resource ready 와 brief 로 읽는다.${gone}`] };
}
