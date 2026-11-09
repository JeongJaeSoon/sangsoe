import type { ViewGate, ViewTask } from "../contract/index.ts";

/**
 * Decision 84③: how a decision's waiter Task reads. An open gate on it is 🚧; once every gate on it is
 * resolved, a Task a worker still holds is 🔄 even when Orca shows it `ready`. Otherwise this has no
 * say and the item_status view reads Orca's state as usual.
 */
export function waiterReading(task: ViewTask, gates: readonly ViewGate[]): "blocked" | "in_progress" | null {
  const own = gates.filter((g) => g.taskId === task.id);
  if (own.some((g) => g.open)) return "blocked";
  if (own.length > 0 && task.activeDispatchId !== undefined) return "in_progress";
  return null;
}
