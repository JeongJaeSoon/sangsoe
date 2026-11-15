import type { StoredEvent } from "../../contract/index.ts";
import { NO_SENDER_TERMINAL, type OrcaAdapter, type TaskRow } from "../../contract/orca.ts";
import { canTransition } from "../../contract/transitions.ts";
import { doneBlockers } from "../../graph/flow.ts";
import { type FullTaskRow, snapshotTasks } from "../../graph/snapshot.ts";
import type { Planned } from "../monitor.ts";
import { isClosedTask, itemStateOf, key } from "./judge.ts";

export type MergeCloseDeps = {
  orca: Pick<OrcaAdapter, "taskList" | "taskUpdate" | "workerShow">;
  events(): StoredEvent[];
  now(): number;
};

/** `closed`: this call closed the Task (not one already closed, left to its worker, or refused). */
export type MergeClose = { ok: boolean; detail: string; planned: Planned[]; closed?: true };

/** Every merged PR whose item Task a `pr_opened` row recorded (the first such row names it). */
export function mergedItemTasks(events: readonly StoredEvent[]): { ref: string; sha: string; task: string }[] {
  const item = new Map<string, string>();
  for (const e of events) {
    if (e.type === "pr_opened" && typeof e.payload.task === "string" && !item.has(String(e.payload.pr))) item.set(String(e.payload.pr), e.payload.task);
  }
  return events.flatMap((e) => {
    const task = e.type === "pr_merged" ? item.get(String(e.payload.pr)) : undefined;
    return task && typeof e.payload.merge_sha === "string" ? [{ ref: String(e.payload.pr), sha: e.payload.merge_sha, task }] : [];
  });
}

/**
 * Decision 84 ① as decision 275 amends it: the one close a detector makes, after the merge is
 * confirmed, and only of a Task no live Dispatch holds. A Task whose worker still runs is left open
 * for that worker's worker_done to close (owner decision d149). What cannot be read (the Task's Run,
 * its rows, its Dispatch) closes nothing.
 * pr-monitor's round and the hook of the session that holds the Run both call this: the round runs
 * in the plugin's process, which Orca takes no write from (decision 274).
 */
export async function closeMerged(
  d: MergeCloseDeps,
  a: { ref: string; sha: string; task: string; run: string | undefined; source: string; rows?: readonly TaskRow[] },
): Promise<MergeClose> {
  const none = (ok: boolean, detail: string): MergeClose => ({ ok, detail, planned: [] });
  if (!a.run) return none(false, `Run of ${a.task} unread`);
  let rows = a.rows;
  if (!rows) {
    const l = await d.orca.taskList({ run: a.run, full: true });
    if (!l.ok) return none(false, `task-list ${a.run}: ${l.error.code}`);
    rows = l.value;
  }
  const row = rows.find((x) => x.id === a.task);
  if (!row) return none(false, `${a.task} is not a Task of ${a.run}`);
  // The raw status: the snapshot folds statuses it does not list (Orca's "cancelled") into blocked.
  if (isClosedTask(row.status)) return none(true, `already ${row.status}`);
  if (row.dispatchId) {
    const show = await d.orca.workerShow({ dispatch: row.dispatchId });
    if (!show.ok) return none(false, `worker-show ${row.dispatchId}: ${show.error.code}`);
    if (show.value.liveness === "live") return none(true, `left open: Dispatch ${row.dispatchId} is live`);
  }
  // Decision 212 ④: every child and every PR of the item is read from this Run's rows.
  const tasks = snapshotTasks(rows as FullTaskRow[], a.run);
  const blockers = doneBlockers({ orca: { tasks, gates: [] }, events: d.events(), now: new Date(d.now()).toISOString() }, a.task);
  if (blockers.length > 0) return none(false, `done_blockers: ${blockers.join(" · ")}`);
  const from = itemStateOf(row.status);
  const u = await d.orca.taskUpdate({ id: a.task, status: "completed", result: `merged ${a.ref} as ${a.sha}`, run: a.run });
  if (!u.ok) return none(false, u.error.code === NO_SENDER_TERMINAL ? "left to the session that holds the Run: this process has no terminal" : `${u.error.code}: ${u.error.message}`);
  const planned: Planned[] =
    from && canTransition(from, "done")
      ? [{ type: "item_transition", source: a.source, dedupe_key: key("item_transition", a.task, "done"), payload: { task: a.task, from, to: "done", reason: `pr_merged ${a.ref}` } }]
      : [];
  return { ok: true, detail: from ? `${from} → done` : "closed", planned, closed: true };
}
