import type { OrcaAdapter, WorkerRow } from "../contract/orca.ts";

export type RecoverRow = {
  task: string;
  dispatch: string;
  state: string;
  liveness: string;
  terminal: string;
  worktree: string;
  /** Not live and not settled: a session the restart may have taken. */
  lost: boolean;
};

export type RecoverPlan = { rows: RecoverRow[]; truncated: boolean; nonLocal: number } | { error: string };

// Real Orca reports a finished worker's state as its outcome (`succeeded`), the recording as `settled`.
const FINISHED = new Set(["settled", "released", "succeeded", "failed", "cancelled", "abandoned", "stopped"]);
export const settled = (w: Pick<WorkerRow, "state" | "terminalState">) => FINISHED.has(w.state) || w.terminalState === "released";

/** Decision 80 N4: one read-only table; reviving is Orca's (`worker-start --retry-of`, `run-use`). */
export async function recoverPlan(orca: OrcaAdapter, a: { run?: string; limit?: number } = {}): Promise<RecoverPlan> {
  const r = await orca.workerList({ ...(a.run ? { run: a.run } : {}), limit: a.limit ?? 50 });
  if (!r.ok) return { error: `worker-list 실패 (${r.error.code}: ${r.error.message})` };
  const rows = r.value.rows.map((w) => ({
    task: w.taskId,
    dispatch: w.dispatchId,
    state: w.state,
    liveness: w.liveness ?? "?",
    terminal: w.terminalState ?? "?",
    worktree: w.workspace ?? "",
    lost: w.liveness !== "live" && !settled(w),
  }));
  return { rows, truncated: r.value.truncated, nonLocal: r.value.nonLocal.rows };
}

export function renderRecover(plan: RecoverPlan): string[] {
  if ("error" in plan) return [`🔴 ${plan.error}`];
  const head = ["", "Task", "Dispatch", "상태", "liveness", "터미널", "worktree"];
  const body = plan.rows.map((r) => [r.lost ? "⚠️" : "·", r.task, r.dispatch, r.state, r.liveness, r.terminal, r.worktree]);
  const lines = [head, ...body].map((cells) => `| ${cells.join(" | ")} |`);
  lines.splice(1, 0, `|${head.map(() => "---").join("|")}|`);
  const lost = plan.rows.filter((r) => r.lost).length;
  lines.push("", `워커 ${plan.rows.length}개 · 잃었을 수 있는 것 ${lost}개${plan.truncated ? " · 목록이 잘렸다(--limit)" : ""}${plan.nonLocal ? ` · 다른 호스트 ${plan.nonLocal}개는 뺐다` : ""}`);
  lines.push("읽기 전용이다. 되살리기는 Orca 의 `worker-start --task <id> --retry-of <dispatch>` 와 `run-use` 가 한다.");
  return lines;
}
