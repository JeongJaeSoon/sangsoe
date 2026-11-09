import type { OrcaAdapter } from "../contract/orca.ts";

export type UnitLineage = {
  taskId: string;
  dispatchId?: string;
  runId?: string;
  worktreeId?: string;
  parentWorktreeId?: string | null;
  problems: string[];
};

/**
 * Regression scenario `unit_lineage_complete` (decision 94 (사)): for every started unit read its
 * Dispatch, Run and new worktree's `parentWorktreeId` back from Orca. Any one missing, or a parent
 * other than the expected one, is a problem. Read-only.
 */
export async function checkLineage(
  orca: OrcaAdapter,
  units: readonly { taskId: string; parentWorktreeId: string }[],
): Promise<{ ok: boolean; units: UnitLineage[] }> {
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
    if (typeof d.value.run_id === "string" && d.value.run_id !== "") row.runId = d.value.run_id;
    else row.problems.push("Dispatch 에 Run 이 없다");
    const w = await orca.workerShow({ dispatch: d.value.id });
    if (!w.ok || !w.value.workspace) {
      row.problems.push(`워커의 worktree 를 읽지 못했다 (${w.ok ? "workspace 없음" : w.error.code})`);
      continue;
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
