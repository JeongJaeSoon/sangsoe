import { dedupeKey, eventDef, type StoredEvent } from "../../contract/index.ts";
import type { GateRow, InboxMessage, LocalRows, WorkerRow, WorkerShow, WorktreePsRow } from "../../contract/orca.ts";
import { isOpenGate } from "../../decision/waiters.ts";
import { settled } from "../../recover/recover.ts";
import { type MonitorConfig, minutes, type Planned, type Reading } from "../monitor.ts";
import { judgeMail } from "./mail.ts";

const SOURCE = "orca-monitor";

/** What one orca-monitor round read. A read that failed is null and judges nothing. */
export type OrcaReads = {
  ps: LocalRows<WorktreePsRow> | null;
  workers: LocalRows<WorkerRow> | null;
  /** worker-show per unfinished worker, by Dispatch id; it carries the Run id worker-list leaves out. */
  shows: Record<string, WorkerShow | null>;
  /** `worker-list --run` per Run the unfinished workers belong to, every page: the Run's membership. */
  runs: Record<string, LocalRows<WorkerRow> | null>;
  /** gate-list per Run the unfinished workers belong to. */
  gates: Record<string, GateRow[] | null>;
  inbox: InboxMessage[] | null;
  /** sqlite rows of ORCA_EVENT_TYPES. */
  events: readonly StoredEvent[];
  /** Header text of each refusal file the inbox points to (mail.ts); absent: none read. */
  refusals?: ReadonlyMap<string, string | null>;
};

export const ORCA_EVENT_TYPES = [
  "notified",
  "decision_opened",
  "decision_joined",
  "decision_answered",
  "decision_closed",
  "worker_dead",
  "worker_done",
  "rate_limited",
  "refusal_report",
  "waiting_human",
  "waiting_released",
  "observed_change",
];

export const isUnfinished = (w: WorkerRow) => !settled(w);

// Orca reports a lost terminal as `gone`; anything but live or gone (`unverifiable`, missing) is not seen.
const DEAD = new Set(["gone", "exited"]);

const key = (type: Parameters<typeof eventDef>[0], target: string, ...cond: string[]) => {
  const def = eventDef(type);
  if (!def) throw new Error(`no event type ${type}`);
  return dedupeKey(def, target, ...cond);
};

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export type SessionActivity =
  | { kind: "waiting" }
  | { kind: "resting" }
  | { kind: "active"; lastAt: number }
  | { kind: "unseen"; why: string };

/**
 * One session's activity, judged over every terminal of its workspace (decision 87 and appendix
 * `one_session_two_terminals`): Orca's ps rows carry no session id, and a Dispatch has one
 * workspace, so the workspace is the session. A quiet old tab never makes a session stuck while
 * another terminal of it works or waits; a time that is missing or ahead of `now` is not seen.
 */
export function sessionActivity(row: WorktreePsRow, now: number): SessionActivity {
  const agents = row.agents ?? [];
  if (agents.some((a) => a.agentWait !== null && a.agentWait !== undefined)) return { kind: "waiting" };
  if (!agents.some((a) => a.state === "working")) return { kind: "resting" };
  // lastActivityAt is left out: P10 saw it stand still while every working session wrote output
  // (decision 133), so a fresh value would only hide a stuck worker.
  const times: unknown[] = [row.lastOutputAt, ...agents.map((a) => a.stateStartedAt)];
  if (times.some((t) => isTime(t) && t > now)) return { kind: "unseen", why: "time field ahead of the clock" };
  const seen = times.filter(isTime);
  if (seen.length === 0) return { kind: "unseen", why: "no activity time field" };
  return { kind: "active", lastAt: Math.max(...seen) };
}

type Seen = { quiet: boolean; lastAt: number; dead: boolean; blind: boolean };

function judgeWorkers(r: OrcaReads, now: number, c: MonitorConfig, planned: Planned[], unseen: string[]) {
  if (!r.workers) {
    unseen.push("worker-list");
    return;
  }
  if (!r.ps) unseen.push("worktree ps");
  if (r.workers.truncated) unseen.push("worker-list truncated");
  // Workers of the global list plus the members of every Run read, each judged once.
  const all = new Map<string, WorkerRow>();
  for (const rows of [r.workers, ...Object.values(r.runs)]) {
    for (const w of rows?.rows.filter(isUnfinished) ?? []) if (!all.has(w.dispatchId)) all.set(w.dispatchId, w);
  }
  // A stop_failure is one stop of a session that may go on; it does not stand for the terminal's death.
  const recordedDead = new Set(r.events.filter((e) => e.type === "worker_dead" && e.payload.reason !== "stop_failure").map((e) => e.entity_id));
  const isDead = (w: WorkerRow) => w.liveness !== undefined && DEAD.has(w.liveness);
  // "Many at once" counts only deaths first seen in this round.
  const fresh = [...all.values()].filter((w) => isDead(w) && !recordedDead.has(w.dispatchId));
  const reason = fresh.length >= c.hostRestartMin ? "host_restart" : "terminal_gone";

  const psByWorkspace = new Map((r.ps?.rows ?? []).map((row) => [row.worktreeId, row]));
  const seen = new Map<string, Seen>();
  for (const w of all.values()) {
    if (isDead(w)) {
      if (!recordedDead.has(w.dispatchId)) {
        planned.push({
          type: "worker_dead",
          source: SOURCE,
          payload: { reason },
          entity: "dispatch",
          entity_id: w.dispatchId,
          target: w.taskId,
          dedupe_key: key("worker_dead", w.dispatchId),
        });
      }
      seen.set(w.dispatchId, { quiet: true, lastAt: 0, dead: true, blind: false });
      continue;
    }
    const row = w.liveness === "live" && w.workspace ? psByWorkspace.get(w.workspace) : undefined;
    if (!row) {
      if (r.ps || w.liveness !== "live") unseen.push(`${w.dispatchId}: liveness ${w.liveness ?? "missing"}, no ps row`);
      seen.set(w.dispatchId, { quiet: false, lastAt: 0, dead: false, blind: true });
      continue;
    }
    const a = sessionActivity(row, now);
    if (a.kind === "unseen") unseen.push(`${w.dispatchId}: ${a.why}`);
    const quiet = a.kind === "active" && now - a.lastAt > minutes(c.stuckMinutes);
    if (quiet && a.kind === "active") {
      planned.push({
        type: "worker_stuck",
        source: SOURCE,
        payload: { reason: "no_activity" },
        entity: "dispatch",
        entity_id: w.dispatchId,
        target: w.taskId,
        dedupe_key: key("worker_stuck", w.dispatchId, String(a.lastAt)),
      });
    }
    seen.set(w.dispatchId, { quiet, lastAt: a.kind === "active" ? a.lastAt : 0, dead: false, blind: a.kind === "unseen" });
  }
  for (const [id, s] of Object.entries(r.shows)) if (!s) unseen.push(`worker-show ${id}`);

  // A Run all of whose unfinished workers are dead or stuck, judged from that Run's own member
  // list. A list that failed or stopped short, or a member not seen, leaves only that Run unjudged.
  for (const [run, members] of Object.entries(r.runs)) {
    if (!members || members.truncated) {
      unseen.push(`worker-list --run ${run}${members ? " truncated" : ""}`);
      continue;
    }
    const ts = members.rows.filter(isUnfinished).map((w) => seen.get(w.dispatchId));
    if (ts.length === 0 || ts.some((t) => !t || t.blind || !t.quiet)) continue;
    const lastAt = Math.max(...ts.map((t) => t?.lastAt ?? 0));
    const dead = members.rows.filter((w) => seen.get(w.dispatchId)?.dead).map((w) => w.dispatchId);
    const episode = lastAt > 0 ? String(lastAt) : `dead-${dead.sort().join(",")}`;
    planned.push({ type: "run_stalled", source: SOURCE, payload: { run }, dedupe_key: key("run_stalled", run, episode) });
  }
}

function judgeGates(r: OrcaReads, now: number, c: MonitorConfig, planned: Planned[], unseen: string[]) {
  const openedAt = new Map<string, number>();
  const gateDecision = new Map<string, string>();
  const closed = new Set<string>();
  for (const e of r.events) {
    const p = e.payload as { gate?: string; decision?: string };
    if (e.type === "decision_opened" && p.decision) openedAt.set(p.decision, Date.parse(e.ts));
    if (e.type === "decision_joined" && p.gate && p.decision) gateDecision.set(p.gate, p.decision);
    if ((e.type === "decision_answered" || e.type === "decision_closed") && p.decision) closed.add(p.decision);
  }
  for (const [run, gates] of Object.entries(r.gates)) {
    if (!gates) {
      unseen.push(`gate-list ${run}`);
      continue;
    }
    for (const g of gates.filter(isOpenGate)) {
      // decision_open creates the gate before it records decision_joined; a question that starts
      // with a decision number sangsoe issued is its own gate even before that row lands.
      const prefix = /^(d\d+):/.exec(g.question ?? "")?.[1];
      const decision = gateDecision.get(g.id) ?? (prefix && openedAt.has(prefix) ? prefix : undefined);
      if (!decision) {
        planned.push({
          type: "decision_untracked",
          source: SOURCE,
          payload: { gate: g.id },
          ...(g.taskId ? { target: g.taskId } : {}),
          dedupe_key: key("decision_untracked", g.id),
        });
        continue;
      }
      const at = openedAt.get(decision);
      if (closed.has(decision) || at === undefined || now - at < minutes(c.decisionWaitMinutes)) continue;
      planned.push({
        type: "waiting_decision",
        source: SOURCE,
        payload: { decision },
        ...(g.taskId ? { target: g.taskId } : {}),
        dedupe_key: key("waiting_decision", decision),
      });
    }
  }
}

// A `notified` message still unhandled in the inbox after wakeMinutes. A message the inbox page
// does not show is not seen, so nothing is written for it.
function judgeWakes(r: OrcaReads, now: number, c: MonitorConfig, planned: Planned[], unseen: string[]) {
  if (!r.inbox) {
    unseen.push("inbox");
    return;
  }
  const inbox = new Map(r.inbox.map((m) => [m.id, m]));
  for (const e of r.events.filter((x) => x.type === "notified")) {
    const msg = (e.payload as { msg_id: string }).msg_id;
    if (now - Date.parse(e.ts) < minutes(c.wakeMinutes)) continue;
    if (inbox.get(msg)?.handled !== false) continue;
    planned.push({
      type: "wake_unconfirmed",
      source: SOURCE,
      payload: { msg_id: msg },
      ...(e.target ? { target: e.target } : {}),
      dedupe_key: key("wake_unconfirmed", msg),
    });
  }
}

/** The Orca fields observed_change compares between rounds; values stay in memory, never in sqlite. */
export type Observed = { state: string; stage: string; liveness: string };
const OBSERVED_FIELDS = ["state", "stage", "liveness"] as const;

/** Every Dispatch this round's worker lists show, finished ones included. */
function knownWorkers(r: OrcaReads): Map<string, WorkerRow> {
  const all = new Map<string, WorkerRow>();
  for (const rows of [r.workers, ...Object.values(r.runs)]) for (const w of rows?.rows ?? []) if (!all.has(w.dispatchId)) all.set(w.dispatchId, w);
  return all;
}

/** This round's observed fields of each unfinished Dispatch; round.ts keeps them for the next round. */
export function observe(r: OrcaReads): Map<string, Observed> {
  const out = new Map<string, Observed>();
  for (const w of knownWorkers(r).values()) {
    if (!isUnfinished(w)) continue;
    out.set(w.dispatchId, { state: w.state, stage: r.shows[w.dispatchId]?.stage ?? "", liveness: w.liveness ?? "" });
  }
  return out;
}

// P10: with two or more live terminals on one workspace, ps times do not tell which one moved, so a
// change in Orca's own Dispatch fields is the activity record (decision 196). Field names only.
function judgeChanges(r: OrcaReads, previous: ReadonlyMap<string, Observed>, now: number, planned: Planned[]) {
  if (!r.ps) return;
  const ps = new Map(r.ps.rows.map((row) => [row.worktreeId, row]));
  const known = knownWorkers(r);
  for (const [dispatch, cur] of observe(r)) {
    const before = previous.get(dispatch);
    const w = known.get(dispatch);
    const row = w?.workspace ? ps.get(w.workspace) : undefined;
    if (!before || !w || !row || row.liveTerminalCount < 2) continue;
    for (const field of OBSERVED_FIELDS) {
      if (before[field] === cur[field]) continue;
      planned.push({
        type: "observed_change",
        source: SOURCE,
        payload: { task: w.taskId, field },
        entity: "dispatch",
        entity_id: dispatch,
        target: w.taskId,
        dedupe_key: key("observed_change", dispatch, field, String(now)),
      });
    }
  }
}

export function judgeOrca(r: OrcaReads, now: number, c: MonitorConfig, previous: ReadonlyMap<string, Observed> = new Map()): Reading {
  const planned: Planned[] = [];
  const unseen: string[] = [];
  judgeWorkers(r, now, c, planned, unseen);
  judgeGates(r, now, c, planned, unseen);
  judgeWakes(r, now, c, planned, unseen);
  if (r.inbox) {
    const known = knownWorkers(r);
    const unfinished = new Set([...known.values()].filter(isUnfinished).map((w) => w.dispatchId));
    const ps = r.ps ? new Map(r.ps.rows.map((row) => [row.worktreeId, row])) : null;
    judgeMail({ inbox: r.inbox, known, unfinished, ps, events: r.events, refusals: r.refusals ?? new Map() }, planned, unseen);
  }
  judgeChanges(r, previous, now, planned);
  return { planned, unseen };
}
