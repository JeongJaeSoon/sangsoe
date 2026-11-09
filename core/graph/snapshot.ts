import type { OrcaAdapter, TaskRow } from "../contract/orca.ts";
import type { OrcaSnapshot, ViewTask, ViewTaskStatus } from "../contract/views.ts";

// U1's LATER: TaskRow is not a ViewTask. `task-list --full` rows also carry `deps` (a JSON array, as a
// string in Orca's own output), `run_id`, `parent_id` and `result`; this maps them.
export type FullTaskRow = TaskRow & {
  deps?: string | readonly string[];
  run_id?: string;
  parent_id?: string | null;
};

const STATUSES: readonly ViewTaskStatus[] = ["pending", "ready", "dispatched", "blocked", "completed", "failed"];

function depsOf(raw: FullTaskRow["deps"]): string[] {
  if (raw === undefined || raw === null) return [];
  const list: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(list) || list.some((d) => typeof d !== "string")) throw new Error(`deps: expected a string array, got ${JSON.stringify(raw)}`);
  return list as string[];
}

/** Rows of one Run's `task-list --full`. A status Orca adds later is read as `blocked` (never startable). */
export function snapshotTasks(rows: readonly FullTaskRow[], run: string): ViewTask[] {
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id ?? run,
    status: (STATUSES as readonly string[]).includes(r.status) ? (r.status as ViewTaskStatus) : "blocked",
    deps: depsOf(r.deps),
    ...(r.result ? { result: r.result } : {}),
    ...(r.dispatchId ? { activeDispatchId: r.dispatchId } : {}),
  }));
}

export interface ReadSnapshot {
  readonly snapshot: OrcaSnapshot;
  /** Runs whose task-list failed; their Tasks read as unknown, never as absent-so-done. */
  readonly unread: readonly { readonly run: string; readonly error: string }[];
}

/** Reads every named Run. Gates are not read: GRAPH does not need them. */
export async function readSnapshot(orca: OrcaAdapter, runs: readonly string[]): Promise<ReadSnapshot> {
  const tasks: ViewTask[] = [];
  const unread: { run: string; error: string }[] = [];
  for (const run of [...new Set(runs)]) {
    const r = await orca.taskList({ run, full: true });
    if (!r.ok) {
      unread.push({ run, error: `${r.error.code}: ${r.error.message}` });
      continue;
    }
    tasks.push(...snapshotTasks(r.value as FullTaskRow[], run));
  }
  return { snapshot: { tasks, gates: [] }, unread };
}
