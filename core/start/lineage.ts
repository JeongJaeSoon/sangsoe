import type { OrcaAdapter } from "../contract/orca.ts";

export type UnitLineage = {
  taskId: string;
  dispatchId?: string;
  runId?: string;
  worktreeId?: string;
  parentWorktreeId?: string | null;
  problems: string[];
};

export type ExpectedUnit = { taskId: string; runId: string; parentWorktreeId: string };

/**
 * Regression scenario `unit_lineage_complete` (decision 94 (사)): for every started unit read its
 * Dispatch, worker and new worktree back from Orca and check they are one chain: the Dispatch is
 * the Task's and in the expected Run, the worker is that Dispatch's, and the worker's worktree has
 * the expected `parentWorktreeId`. Anything missing or crossed is a problem. Read-only.
 */
export async function checkLineage(orca: OrcaAdapter, units: readonly ExpectedUnit[]): Promise<{ ok: boolean; units: UnitLineage[] }> {
  const trees = await orca.worktreeList({});
  const out: UnitLineage[] = [];
  for (const u of units) {
    const row: UnitLineage = { taskId: u.taskId, problems: [] };
    out.push(row);
    const d = await orca.dispatchShow({ task: u.taskId });
    if (!d.ok || typeof d.value.id !== "string") {
      row.problems.push(`Dispatch 없음 (${d.ok ? "id 없음" : d.error.code})`);
      continue;
    }
    row.dispatchId = d.value.id;
    if (d.value.task_id !== u.taskId) row.problems.push(`Dispatch 의 Task 가 다르다: ${d.value.task_id}`);
    if (typeof d.value.run_id !== "string" || d.value.run_id === "") row.problems.push("Dispatch 에 Run 이 없다");
    else {
      row.runId = d.value.run_id;
      if (d.value.run_id !== u.runId) row.problems.push(`Dispatch 의 Run 이 다르다: ${d.value.run_id}`);
    }
    const w = await orca.workerShow({ dispatch: d.value.id });
    if (!w.ok || !w.value.workspace) {
      row.problems.push(`워커의 worktree 를 읽지 못했다 (${w.ok ? "workspace 없음" : w.error.code})`);
      continue;
    }
    if (w.value.dispatchId !== d.value.id || w.value.taskId !== u.taskId || w.value.runId !== u.runId) {
      row.problems.push("워커가 이 Dispatch·Task·Run 의 것이 아니다");
    }
    row.worktreeId = w.value.workspace;
    if (!trees.ok) {
      row.problems.push(`worktree 목록을 읽지 못했다 (${trees.error.code})`);
      continue;
    }
    const tree = trees.value.rows.find((t) => t.id === w.value.workspace);
    if (!tree) {
      row.problems.push("새 worktree 가 로컬 목록에 없다");
      continue;
    }
    row.parentWorktreeId = tree.parentWorktreeId;
    if (!tree.parentWorktreeId) row.problems.push("parentWorktreeId 가 없다");
    else if (tree.parentWorktreeId !== u.parentWorktreeId) row.problems.push(`부모가 다르다: ${tree.parentWorktreeId}`);
  }
  return { ok: out.every((u) => u.problems.length === 0), units: out };
}
