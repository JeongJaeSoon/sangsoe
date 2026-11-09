import { dedupeKey, eventDef, type StoredEvent } from "../../contract/index.ts";
import type { GateRow, InboxMessage, LocalRows, WorkerRow, WorkerShow, WorktreePsRow } from "../../contract/orca.ts";
import { type MonitorConfig, minutes, type Planned, type Reading } from "../monitor.ts";

const SOURCE = "orca-monitor";

/** What one orca-monitor round read. A read that failed is null and judges nothing. */
export type OrcaReads = {
  ps: LocalRows<WorktreePsRow> | null;
  workers: LocalRows<WorkerRow> | null;
  /** worker-show per unfinished worker, by Dispatch id; it carries the Run id worker-list leaves out. */
  shows: Record<string, WorkerShow | null>;
  /** gate-list per Run the unfinished workers belong to. */
  gates: Record<string, GateRow[] | null>;
  inbox: InboxMessage[] | null;
  /** sqlite rows: notified, decision_opened, decision_answered, decision_closed. */
  events: readonly StoredEvent[];
};

const FINISHED = new Set(["succeeded", "failed", "stopped", "cancelled", "canceled", "released"]);
const OPEN_GATE = new Set(["pending", "open"]);

export const isUnfinished = (w: WorkerRow) => !FINISHED.has(w.state);

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

export function judgeOrca(r: OrcaReads, now: number, c: MonitorConfig): Reading {
  const planned: Planned[] = [];
  const unseen: string[] = [];

  // Workers: dead and stuck, by Dispatch.
  const live = r.workers?.rows.filter(isUnfinished) ?? [];
  if (!r.workers) unseen.push("worker-list");
  const dead = live.filter((w) => w.liveness === "exited");
  const reason = dead.length >= c.hostRestartMin ? "host_restart" : "exited";
  const runOf = (d: string) => r.shows[d]?.runId;
  const stalled = new Map<string, { quiet: number; total: number; lastAt: number }>();
  const tally = (w: WorkerRow, quiet: boolean, lastAt = 0) => {
    const run = runOf(w.dispatchId);
    if (!run) return;
    const t = stalled.get(run) ?? { quiet: 0, total: 0, lastAt: 0 };
    t.total += 1;
    if (quiet) t.quiet += 1;
    t.lastAt = Math.max(t.lastAt, lastAt);
    stalled.set(run, t);
  };
  for (const w of dead) {
    planned.push({
      type: "worker_dead",
      source: SOURCE,
      payload: { reason },
      entity: "dispatch",
      entity_id: w.dispatchId,
      target: w.taskId,
      dedupe_key: key("worker_dead", w.dispatchId),
    });
    tally(w, true);
  }

  const psByWorkspace = new Map((r.ps?.rows ?? []).map((row) => [row.worktreeId, row]));
  if (!r.ps) unseen.push("worktree ps");
  for (const w of live.filter((x) => x.liveness === "live")) {
    const row = w.workspace ? psByWorkspace.get(w.workspace) : undefined;
    if (!row) {
      if (r.ps) unseen.push(`no ps row for ${w.dispatchId}`);
      tally(w, false);
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
    tally(w, quiet, a.kind === "active" ? a.lastAt : 0);
  }

  // A Run all of whose unfinished workers are dead or stuck; the key re-arms on new activity.
  for (const [run, t] of stalled) {
    if (t.total > 0 && t.quiet === t.total) {
      planned.push({
        type: "run_stalled",
        source: SOURCE,
        payload: { run },
        dedupe_key: key("run_stalled", run, t.lastAt > 0 ? String(t.lastAt) : "dead"),
      });
    }
  }

  // Gates: opened through sangsoe (decision_opened) or not.
  const opened = new Map<string, StoredEvent>();
  const closed = new Set<string>();
  for (const e of r.events) {
    const p = e.payload as { gate?: string; decision?: string };
    if (e.type === "decision_opened" && p.gate) opened.set(p.gate, e);
    if ((e.type === "decision_answered" || e.type === "decision_closed") && p.decision) closed.add(p.decision);
  }
  for (const [run, gates] of Object.entries(r.gates)) {
    if (!gates) {
      unseen.push(`gate-list ${run}`);
      continue;
    }
    for (const g of gates.filter((x) => OPEN_GATE.has(x.status))) {
      const o = opened.get(g.id);
      if (!o) {
        planned.push({
          type: "decision_untracked",
          source: SOURCE,
          payload: { gate: g.id },
          ...(g.taskId ? { target: g.taskId } : {}),
          dedupe_key: key("decision_untracked", g.id),
        });
        continue;
      }
      const decision = (o.payload as { decision: string }).decision;
      if (closed.has(decision) || now - Date.parse(o.ts) < minutes(c.decisionWaitMinutes)) continue;
      planned.push({
        type: "waiting_decision",
        source: SOURCE,
        payload: { decision },
        ...(g.taskId ? { target: g.taskId } : {}),
        dedupe_key: key("waiting_decision", decision),
      });
    }
  }

  // Wake-ups: a `notified` message still unhandled in the inbox after wakeMinutes. A message the
  // inbox page does not show is not seen, so nothing is written for it.
  const inbox = new Map((r.inbox ?? []).map((m) => [m.id, m]));
  if (!r.inbox) unseen.push("inbox");
  for (const e of r.events.filter((x) => x.type === "notified")) {
    const msg = (e.payload as { msg_id: string }).msg_id;
    if (now - Date.parse(e.ts) < minutes(c.wakeMinutes) || !r.inbox) continue;
    const m = inbox.get(msg);
    if (!m) continue;
    if (m.handled === false) {
      planned.push({
        type: "wake_unconfirmed",
        source: SOURCE,
        payload: { msg_id: msg },
        ...(e.target ? { target: e.target } : {}),
        dedupe_key: key("wake_unconfirmed", msg),
      });
    }
  }

  return { planned, unseen };
}
