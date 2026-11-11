import { answerNotifiedKey, dedupeKey, EVENTS, type StoredEvent, type ViewInput, type ViewTask } from "../../contract/index.ts";
import type { MootEvidence } from "../../decision/moot.ts";
import { foldFacts } from "../../graph/facts.ts";
import { readyNotifiedKey } from "../../graph/notify-ready.ts";
import { inEdges, readiness, triggerKind } from "../../graph/ready.ts";
import { decision as decisionView } from "../../store/views/decision.ts";
import type { Planned } from "../monitor.ts";

export const QUEUE_SOURCE = "monitor:queue";

export type ReadyItem = { readonly task: string; readonly item: string; readonly event: Planned };
export type Moot = { readonly decision: string; readonly evidence: MootEvidence };
export type Reanswer = {
  readonly decision: string;
  readonly ownerAction: number;
  readonly answer: string;
  readonly linkedBy: "hook" | "button" | "orchestrator" | "observed";
};
/** A handed-off answer whose gate is still open past the wait: one escalation_stale, then one tier up. */
export type StaleAnswer = { readonly decision: string; readonly task: string; readonly run: string; readonly handoffKey: string; readonly event: Planned };

export type QueueJudgment = {
  /** Items the ready view lists: each gets item_ready once its lead was told (notifyReady). */
  readonly ready: readonly ReadyItem[];
  /** todo_due and trigger_unclear: written as they are. */
  readonly planned: readonly Planned[];
  readonly moot: readonly Moot[];
  readonly reanswer: readonly Reanswer[];
  readonly stale: readonly StaleAnswer[];
};

// Same reading as the decision view and core/decision/waiters.ts: Orca writes a cancel as failed+cancelled.
const closed = (t: ViewTask) => t.status === "completed" || (t.status === "failed" && t.result === "cancelled");
const waiting = (t: ViewTask) => t.status === "pending" || t.status === "ready";
const LINKED_BY = new Set(["hook", "button", "orchestrator", "observed"]);

/**
 * The queue-monitor's judgment over one snapshot: what to write and which core functions to call.
 * Pure. A Task the snapshot lacks (its Run unread) is unknown and earns no action.
 */
export function judgeQueue(input: ViewInput, cfg: { decisionWaitMinutes: number }): QueueJudgment {
  const facts = foldFacts(input.events);
  const tasks = new Map(input.orca.tasks.map((t) => [t.id, t]));
  const ready: ReadyItem[] = [];
  const planned: Planned[] = [];

  for (const r of readiness(input)) {
    const trigger = facts.items.get(r.task)?.trigger;
    if (r.readiness === "ready") {
      const edges = inEdges(r.task, facts, tasks).map((e) => `${e.pred}|${e.kind}`);
      const hash = readyNotifiedKey(r.task, edges).dedupe_key.split(":").pop() ?? "";
      ready.push({ task: r.task, item: r.item, event: taskEvent("item_ready", r.task,dedupeKey(EVENTS.item_ready, r.task, hash)) });
    }
    if (r.readiness === "owner_ready" && trigger && triggerKind(trigger) === "date") {
      planned.push(taskEvent("todo_due", r.task,dedupeKey(EVENTS.todo_due, r.task, trigger)));
    }
    const t = tasks.get(r.task);
    if (t && waiting(t) && trigger && triggerKind(trigger) === "text") {
      planned.push(taskEvent("trigger_unclear", r.task,dedupeKey(EVENTS.trigger_unclear, r.task)));
    }
  }

  const runOf = joinedRuns(input.events);
  const openedAt = seqOf(input.events, "decision_opened", "decision");
  // The latest close: a PR reopened and closed again lost its cause at the second close (decision 216).
  const closedAt = new Map(input.events.filter((e) => e.type === "pr_closed").map((e) => [String(e.payload.pr), e.seq] as const));
  const answered = new Map(
    input.events.filter((e) => e.type === "decision_answered" && e.payload.late !== true).map((e) => [String(e.payload.decision), e] as const),
  );
  const told = new Map(input.events.filter((e) => e.type === "notified" && e.dedupe_key).map((e) => [e.dedupe_key as string, e] as const));
  const openGates = new Set(input.orca.gates.filter((g) => g.open).map((g) => g.id));
  const waitLimit = Date.parse(input.now) - cfg.decisionWaitMinutes * 60_000;
  const moot: Moot[] = [];
  const reanswer: Reanswer[] = [];
  const stale: StaleAnswer[] = [];

  for (const d of decisionView(input)) {
    if (d.state === "open") {
      const waiters = d.waiters.filter((w) => facts.items.get(w.task)?.execBy !== "owner");
      const rows = waiters.map((w) => tasks.get(w.task));
      if (waiters.length > 0 && rows.every((t) => t !== undefined && closed(t))) {
        moot.push({ decision: d.decision, evidence: { kind: "tasks_closed" } });
        continue;
      }
      // A waiter whose Task row was not read (its Run unread) is unknown: zero action.
      if (rows.some((t) => t === undefined)) continue;
      // A waiter lost its cause when its PR closed unmerged after the decision opened and no other PR of
      // its Task is still open; every live waiter must have lost it, or someone still waits on the answer.
      const since = openedAt.get(d.decision) ?? Number.POSITIVE_INFINITY;
      const prs = [...facts.prs.values()];
      const lost = (task: string) => {
        const mine = prs.filter((p) => p.tasks.has(task));
        if (mine.some((p) => !p.closed && !p.merged)) return undefined;
        return mine.find((p) => p.closed && !p.merged && (closedAt.get(p.pr) ?? 0) > since);
      };
      const live = waiters.filter((_, i) => !(rows[i] && closed(rows[i])));
      const lostPrs = live.map((w) => lost(w.task));
      const first = lostPrs[0];
      if (first && lostPrs.every((p) => p !== undefined)) moot.push({ decision: d.decision, evidence: { kind: "pr_closed", pr: first.pr } });
      continue;
    }
    if (!d.undelivered) continue;
    const a = answered.get(d.decision);
    const linkedBy = String(a?.payload.linked_by ?? "");
    if (!a || typeof a.payload.owner_action !== "number" || !LINKED_BY.has(linkedBy)) continue;
    reanswer.push({ decision: d.decision, ownerAction: a.payload.owner_action, answer: String(a.payload.answer ?? ""), linkedBy: linkedBy as Reanswer["linkedBy"] });
    for (const w of d.waiters) {
      const run = runOf.get(`${d.decision}|${w.task}`);
      if (!run || !w.gate || !openGates.has(w.gate)) continue;
      const handoffKey = `${answerNotifiedKey(d.decision, w.task).dedupe_key}:resolve`;
      const handoff = told.get(handoffKey);
      if (!handoff || Date.parse(handoff.ts) > waitLimit) continue;
      stale.push({
        decision: d.decision,
        task: w.task,
        run,
        handoffKey,
        event: {
          type: "escalation_stale",
          source: QUEUE_SOURCE,
          payload: { ref: d.decision },
          entity: "task",
          entity_id: w.task,
          dedupe_key: dedupeKey(EVENTS.escalation_stale, d.decision, "undelivered", w.task),
        },
      });
    }
  }
  return { ready, planned, moot, reanswer, stale };
}

function taskEvent(type: "item_ready" | "todo_due" | "trigger_unclear", task: string, key: string): Planned {
  return { type, source: QUEUE_SOURCE, payload: { task }, entity: "task", entity_id: task, dedupe_key: key };
}

/** The seq of the first row of `type` per value of `field`. */
function seqOf(events: readonly StoredEvent[], type: string, field: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    const k = e.payload[field];
    if (e.type === type && typeof k === "string" && !out.has(k)) out.set(k, e.seq);
  }
  return out;
}

function joinedRuns(events: readonly StoredEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) {
    if (e.type === "decision_joined" && typeof e.payload.run === "string") out.set(`${String(e.payload.decision)}|${String(e.payload.waiter)}`, e.payload.run);
  }
  return out;
}
