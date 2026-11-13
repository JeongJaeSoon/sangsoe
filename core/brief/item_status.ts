import type { ItemReading, ItemStatusRow, ItemStatusView, StoredEvent, ViewInput, WaitsOn } from "../contract/index.ts";
import { type Facts, foldFacts } from "../graph/facts.ts";
import { itemRef, prNode } from "../graph/nodes.ts";
import { mergedItemMark } from "../verify/evidence.ts";
import { type Hold, holdOf, retiredOf } from "../graph/ready.ts";
import { waiterReading } from "../decision/held.ts";
import { countsAsEvidence } from "../owner/marks.ts";
import { decision } from "../store/views/decision.ts";
import { graphRead } from "../graph/read.ts";
import type { GraphRead } from "./graph.ts";
import type { BriefTask } from "./types.ts";

export type Priority = "P0" | "P1" | "P2" | "P3";
export const OTHERS = "others";

/** Everything the brief reads about one item, folded once from the snapshot and the events. */
export interface ItemFacts {
  readonly task: string;
  readonly alias: string;
  readonly title: string;
  readonly state: ItemReading;
  readonly waitsOn: WaitsOn | null;
  /** When the item entered its state: last item_transition, else item_created. */
  readonly since: string | null;
  readonly lead: string;
  readonly priority: Priority;
  readonly who: string;
  readonly execBy: string | null;
  readonly whyOwner: string | null;
  readonly cmdHint: string | null;
  readonly reviewTrigger: string | null;
  readonly lastReason: string | null;
  readonly assignee: string | null;
  readonly pr: string | null;
  readonly openDecisions: readonly string[];
  readonly undelivered: readonly string[];
  readonly alarms: readonly string[];
  readonly unclear: boolean;
  /** In progress and its worker_idle (decision 186) is newer than its last move: the 대기 line. */
  readonly idle: boolean;
  readonly evidenceShort: boolean;
  readonly closedAt: string | null;
}

// Decision 198: decision 186's events that ask for action or judgment (pr_changes_requested,
// review_commented, refusal_report) join the 🚨 line, on the same "until the item moves" rule.
const ALARMS = new Set([
  "worker_stuck",
  "worker_dead",
  "ci_failed",
  "land_failed",
  "loop_detected",
  "decision_untracked",
  "pr_changes_requested",
  "review_commented",
  "refusal_report",
]);
// The author's session is gone while the item waits on the merge: only the PR's own alarms still apply.
const PR_ALARMS = new Set(["ci_failed", "land_failed", "pr_changes_requested", "review_commented"]);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const latest = (a: string | null, b: string | null): string | null => (a === null ? b : b === null || Date.parse(a) >= Date.parse(b) ? a : b);

const RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
export const rank = (p: Priority): number => RANK[p];

// A row on a Dispatch (worker_dead, decision 201): orca-monitor names the Task in `target`; a failed
// start does not, and the Task is the one a worker_done or Orca's activeDispatchId pairs it with.
function taskOf(e: StoredEvent, prTask: ReadonlyMap<string, string>, dispatchTask: ReadonlyMap<string, string>): string | null {
  const onDispatch = e.entity === "dispatch" && e.entity_id ? (e.target ?? dispatchTask.get(e.entity_id) ?? null) : null;
  const t = str(e.payload.task) ?? (e.entity === "task" ? e.entity_id : null) ?? onDispatch;
  if (t) return t;
  const pr = str(e.payload.pr);
  return pr ? (prTask.get(pr) ?? null) : null;
}

// Decision 218: the 🚧 readings come from GRAPH's holdOf, the same answer the why rows are written from.
function stateOf(t: BriefTask, hold: Hold | null, held: ReturnType<typeof waiterReading>, ready: boolean, retired: boolean): ItemReading {
  if (retired) return "cancelled";
  if (t.status === "completed") {
    if (hold?.by !== "pr") return "done";
    return hold.state === "open" ? "blocked" : hold.state === "closed_unmerged" ? "pr_closed" : "unknown";
  }
  if (t.status === "failed" && t.result === "cancelled") return "cancelled";
  if (hold?.by === "gate") return "blocked";
  if (held) return held;
  if (t.status === "dispatched") return "in_progress";
  if (hold?.by === "orca") return hold.onHold ? "on_hold" : "blocked";
  // Orca's own `ready` is not enough: GRAPH's extra edges, trigger and hold decide (decision 147).
  return ready ? "ready" : "planned";
}

/** Items are Orca Tasks with an item_created row; a row whose Task Orca no longer lists is left out. */
export function itemFacts(input: ViewInput, graph: GraphRead = graphRead): ItemFacts[] {
  const extra = new Map<string, Record<string, unknown>>();
  const created = new Map<string, StoredEvent>();
  const transition = new Map<string, StoredEvent>();
  const closedAt = new Map<string, string>();
  const mergedAt = new Map<string, string>();
  const prio = new Map<string, Priority>();
  const prTask = new Map<string, string>();
  const prOpen = new Map<string, string>();
  const evidence = new Set<string>();
  const alarms = new Map<string, Map<string, number>>();
  const unclear = new Map<string, number>();
  const moved = new Map<string, number>();
  const idle = new Map<string, number>();
  const comments = new Map<string, { seq: number; at: string | null }[]>();
  const replied = new Map<string, string>();
  const dispatchTask = new Map<string, string>();
  for (const t of input.orca.tasks) if (t.activeDispatchId) dispatchTask.set(t.activeDispatchId, t.id);
  for (const e of input.events) {
    const d = e.entity === "dispatch" ? e.entity_id : str(e.payload.dispatch);
    const t = e.entity === "dispatch" ? e.target : str(e.payload.task);
    if (d && t) dispatchTask.set(d, t);
  }

  for (const e of input.events) {
    const p = e.payload;
    if (e.type === "item_created") created.set(String(p.task), e);
    else if (e.type === "item_extra_set") extra.set(String(p.task), { ...extra.get(String(p.task)), ...p });
    else if (e.type === "priority_set") prio.set(String(p.subject), p.value as Priority);
    else if (e.type === "item_transition") {
      transition.set(String(p.task), e);
      moved.set(String(p.task), e.seq);
      if (p.to === "done") closedAt.set(String(p.task), e.ts);
    } else if (e.type === "pr_opened" && str(p.task)) {
      prTask.set(String(p.pr), String(p.task));
      prOpen.set(String(p.task), String(p.pr));
    } else if (e.type === "pr_reopened") {
      const t = prTask.get(String(p.pr));
      if (t) prOpen.set(t, String(p.pr));
    } else if (e.type === "pr_merged" || e.type === "pr_closed") {
      const t = prTask.get(String(p.pr));
      if (t && prOpen.get(t) === p.pr) prOpen.delete(t);
      if (t && e.type === "pr_merged") mergedAt.set(t, e.ts);
    } else if (countsAsEvidence(e) && e.entity === "task" && e.entity_id) evidence.add(e.entity_id);
    else if (e.type === "trigger_unclear") unclear.set(String(p.task), e.seq);
    if (ALARMS.has(e.type)) {
      const t = taskOf(e, prTask, dispatchTask);
      const name = e.type === "worker_dead" && p.cause === "auth" ? "worker_dead:auth" : e.type;
      if (t) {
        const m = new Map(alarms.get(t));
        // One worker_dead alarm per item: the newer stop's reading replaces the older one.
        if (e.type === "worker_dead") m.delete(name === "worker_dead" ? "worker_dead:auth" : "worker_dead");
        alarms.set(t, m.set(name, e.seq));
      }
    }
    if (e.type === "worker_idle") {
      const t = taskOf(e, prTask, dispatchTask);
      if (t) idle.set(t, e.seq);
    }
    if (e.type === "review_commented" || e.type === "review_replied") {
      const t = taskOf(e, prTask, dispatchTask);
      const at = str(p.at);
      if (t && e.type === "review_commented") comments.set(t, [...(comments.get(t) ?? []), { seq: e.seq, at }]);
      else if (t && at) replied.set(t, latest(replied.get(t) ?? null, at) ?? at);
    }
  }

  const prFacts = foldFacts(input.events);
  const decisions = decision(input);
  const ready = new Set(graph.ready(input).map((r) => r.task));
  const out: ItemFacts[] = [];
  for (const t of input.orca.tasks as readonly BriefTask[]) {
    const c = created.get(t.id);
    if (!c) continue;
    const x = extra.get(t.id) ?? {};
    const lead = str(x.lead) ?? OTHERS;
    const own = decisions.filter((d) => d.waiters.some((w) => w.task === t.id));
    const openDecisions = own.filter((d) => d.state === "open").map((d) => d.decision);
    // Decisions 175 and 178: the author's worker_done completes the Task in Orca before its PR merges.
    const hold = holdOf(t, prFacts, input.orca.gates);
    const prRead = stateOf(t, hold, waiterReading(t, input.orca.gates), ready.has(t.id), retiredOf(t, prFacts));
    // Decision 181: an owner to-do closes on verification, whoever completed the Task.
    const verifiedAt = prFacts.ownerVerify.get(t.id);
    const state: ItemReading = prRead === "done" && verifiedAt === null ? "pending_verify" : prRead;
    const p = hold?.by === "pr" ? hold : null;
    const prWait = p !== null;
    const last = moved.get(t.id) ?? 0;
    // Decision 201: review comments are answered when the author's reply is newer, by GitHub's time,
    // than every comment since the last move; a comment without that time is never taken as answered.
    const open = (comments.get(t.id) ?? []).filter((c) => c.seq > last);
    const reply = replied.get(t.id) ?? null;
    const answered = reply !== null && open.every((c) => c.at !== null && Date.parse(reply) > Date.parse(c.at));
    // An alarm stands until the item moves again.
    const standing = [...(alarms.get(t.id) ?? new Map<string, number>())]
      .filter(([type, seq]) => seq > last && (!prWait || PR_ALARMS.has(type)) && !(type === "review_commented" && answered))
      .map(([type]) => type);
    const undelivered = own.filter((d) => d.undelivered).map((d) => d.decision);
    const waitsOn: WaitsOn | null =
      state === "pr_closed"
        ? "lead"
        : prWait
          ? "reviewer"
          : ((openDecisions.length > 0 || undelivered.length > 0 ? "owner" : (str(x.waits_on) as WaitsOn | null)) ?? null);
    out.push({
      task: t.id,
      alias: String(c.payload.alias),
      title: t.title ?? t.id,
      state,
      waitsOn: state === "blocked" || state === "pr_closed" ? waitsOn : null,
      since: transition.get(t.id)?.ts ?? c.ts,
      lead,
      priority: prio.get(t.id) ?? (str(x.priority) as Priority | null) ?? prio.get(`lead:${lead}`) ?? "P2",
      who: String(c.payload.who),
      execBy: str(x.exec_by),
      whyOwner: str(x.why_owner),
      cmdHint: str(x.cmd_hint),
      reviewTrigger: str(x.review_trigger),
      lastReason: str(transition.get(t.id)?.payload.reason),
      assignee: t.assignee ?? null,
      pr: prOpen.get(t.id) ?? (prWait ? (p?.prs[0] ?? null) : null),
      openDecisions,
      undelivered,
      alarms: state === "done" || state === "cancelled" ? [] : standing,
      unclear: (unclear.get(t.id) ?? 0) > last,
      idle: state === "in_progress" && (idle.get(t.id) ?? 0) > last,
      evidenceShort: state === "done" && (!evidence.has(t.id) || mergedMark(t.id, prFacts, input.events) === "unverified"),
      // A worker_done or a lead's task-update closes a Task with no item_transition (decision 175, S7).
      closedAt: state === "done" ? latest(closedAt.get(t.id) ?? mergedAt.get(t.id) ?? t.completedAt ?? null, verifiedAt ?? null) : null,
    });
  }
  return out;
}

/**
 * Flow 3: the item's merged PR sets off a deploy when a deploys_after edge leaves that PR, the item,
 * or a member of its flow (ship-change hangs it on the merge step, the PR on impl).
 */
function mergedMark(task: string, g: Facts, events: readonly StoredEvent[]): "done" | "unverified" {
  const pr = [...g.prs.values()].filter((p) => p.merged && p.tasks.has(task)).at(-1)?.pr;
  if (!pr) return "done";
  const flow = g.items.get(task)?.flow;
  const members = new Set([task]);
  if (flow !== undefined) for (const x of g.items.values()) if (x.flow === flow || x.task === flow) members.add(x.task);
  const from = new Set([prNode(pr), ...[...members].map(itemRef)]);
  const deploysAfter = g.edges.some((e) => e.kind === "deploys_after" && from.has(e.pred));
  return mergedItemMark({ pr, deploysAfter, events });
}

export const toStatusRow =(f: ItemFacts): ItemStatusRow => ({
  task: f.task,
  alias: f.alias,
  state: f.state,
  waitsOn: f.waitsOn,
  since: f.since,
  decisionOpen: f.openDecisions.length > 0,
  alarms: f.alarms,
  unclear: f.unclear,
  evidenceShort: f.evidenceShort,
});

export const item_status: ItemStatusView = (input) => itemFacts(input).map(toStatusRow);

/** Lead priority: priority_set{lead:<name>}; "others" takes the most urgent of its items. */
export function leadPriority(input: ViewInput, lead: string, items: readonly ItemFacts[]): Priority {
  if (lead === OTHERS) {
    const ps = items.filter((f) => f.lead === OTHERS).map((f) => f.priority);
    return ps.sort((a, b) => rank(a) - rank(b))[0] ?? "P2";
  }
  let p: Priority = "P2";
  for (const e of input.events) if (e.type === "priority_set" && e.payload.subject === `lead:${lead}`) p = e.payload.value as Priority;
  return p;
}
