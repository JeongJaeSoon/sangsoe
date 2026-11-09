import { parseArgs } from "node:util";
import { createOrcaAdapter, nodeExec, type OrcaAdapter, recoverPlan, renderRecover } from "../../core/index.ts";

export const USAGE = `usage: sangsoe recover [--run <run id>] [--limit <n>]

Read-only table of supervised workers after a restart: Task, Dispatch, state, liveness, worktree.
Rows marked ⚠️ are neither live nor settled. Nothing is written; reviving is Orca's.`;

export async function recover(argv: readonly string[], orca: OrcaAdapter = createOrcaAdapter(nodeExec())) {
  let values: { run?: string; limit?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { run: { type: "string" }, limit: { type: "string" }, help: { type: "boolean", short: "h" } },
      strict: true,
    }));
  } catch (err) {
    return { code: 2, out: `${(err as Error).message}\n${USAGE}` };
  }
  if (values.help) return { code: 0, out: USAGE };
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) return { code: 2, out: `--limit must be a positive integer\n${USAGE}` };
  const plan = await recoverPlan(orca, { ...(values.run ? { run: values.run } : {}), ...(limit ? { limit } : {}) });
  return { code: "error" in plan ? 1 : 0, out: renderRecover(plan).join("\n") };
}
