import type { ItemState, ItemStatusRow, ItemStatusView, StoredEvent, ViewInput, WaitsOn } from "../contract/index.ts";
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
  readonly state: ItemState;
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
  readonly evidenceShort: boolean;
  readonly closedAt: string | null;
}

const ALARMS = new Set(["worker_stuck", "worker_dead", "ci_failed", "land_failed", "loop_detected", "decision_untracked"]);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
export const rank = (p: Priority): number => RANK[p];

function taskOf(e: StoredEvent, prTask: ReadonlyMap<string, string>): string | null {
  const t = str(e.payload.task) ?? (e.entity === "task" ? e.entity_id : null);
  if (t) return t;
  const pr = str(e.payload.pr);
  return pr ? (prTask.get(pr) ?? null) : null;
}

function stateOf(t: BriefTask, hold: boolean, held: ReturnType<typeof waiterReading>, ready: boolean): ItemState {
  if (t.status === "completed") return "done";
  if (t.status === "failed" && t.result === "cancelled") return "cancelled";
  if (held) return held;
  if (t.status === "dispatched") return "in_progress";
  if (t.status === "blocked" || t.status === "failed") return hold ? "on_hold" : "blocked";
  // Orca's own `ready` is not enough: GRAPH's extra edges, trigger and hold decide (decision 147).
  return ready ? "ready" : "planned";
}

/** Items are Orca Tasks with an item_created row; a row whose Task Orca no longer lists is left out. */
export function itemFacts(input: ViewInput, graph: GraphRead = graphRead): ItemFacts[] {
  const extra = new Map<string, Record<string, unknown>>();
  const created = new Map<string, StoredEvent>();
  const transition = new Map<string, StoredEvent>();
  const closedAt = new Map<string, string>();
  const prio = new Map<string, Priority>();
  const prTask = new Map<string, string>();
  const prOpen = new Map<string, string>();
  const evidence = new Set<string>();
  const alarms = new Map<string, Map<string, number>>();
  const unclear = new Map<string, number>();
  const moved = new Map<string, number>();

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
    } else if (e.type === "pr_merged" || e.type === "pr_closed") {
      const t = prTask.get(String(p.pr));
      if (t && prOpen.get(t) === p.pr) prOpen.delete(t);
    } else if (countsAsEvidence(e) && e.entity === "task" && e.entity_id) evidence.add(e.entity_id);
    else if (e.type === "trigger_unclear") unclear.set(String(p.task), e.seq);
    if (ALARMS.has(e.type)) {
      const t = taskOf(e, prTask);
      if (t) alarms.set(t, new Map(alarms.get(t)).set(e.type, e.seq));
    }
  }

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
    const closed = stateOf(t, x.hold === true && str(x.review_trigger) !== null, waiterReading(t, input.orca.gates), ready.has(t.id));
    // Decision 175: the author's worker_done completes the Task in Orca; the item waits on review until the merge.
    const awaitingMerge = closed === "done" && prOpen.has(t.id);
    const state: ItemState = awaitingMerge ? "blocked" : closed;
    const last = moved.get(t.id) ?? 0;
    // An alarm stands until the item moves again.
    const standing = [...(alarms.get(t.id) ?? new Map<string, number>())].filter(([, seq]) => seq > last).map(([type]) => type);
    const undelivered = own.filter((d) => d.undelivered).map((d) => d.decision);
    const waitsOn = awaitingMerge
      ? "reviewer"
      : ((openDecisions.length > 0 || undelivered.length > 0 ? "owner" : (str(x.waits_on) as WaitsOn | null)) ?? null);
    out.push({
      task: t.id,
      alias: String(c.payload.alias),
      title: t.title ?? t.id,
      state,
      waitsOn: state === "blocked" ? waitsOn : null,
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
      pr: prOpen.get(t.id) ?? null,
      openDecisions,
      undelivered,
      alarms: state === "done" || state === "cancelled" ? [] : standing,
      unclear: (unclear.get(t.id) ?? 0) > last,
      evidenceShort: state === "done" && !evidence.has(t.id),
      closedAt: state === "done" ? (closedAt.get(t.id) ?? null) : null,
    });
  }
  return out;
}

export const toStatusRow = (f: ItemFacts): ItemStatusRow => ({
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
