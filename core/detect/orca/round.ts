import type { GateRow, OrcaResult, WorkerShow } from "../../contract/orca.ts";
import type { MonitorDeps, Reading } from "../monitor.ts";
import { isUnfinished, judgeOrca } from "./judge.ts";

const value = <T>(r: OrcaResult<T>): T | null => (r.ok ? r.value : null);

const EVENT_TYPES = ["notified", "decision_opened", "decision_answered", "decision_closed"];

/**
 * One orca-monitor round: Orca reads through the adapter only, mail through `inbox`, which never
 * marks it handled; then the pure judgment. Rows of other hosts never reach it (decision 88 ①).
 */
export async function orcaRound(d: MonitorDeps, signal: AbortSignal): Promise<Reading> {
  const [ps, workers, inbox] = await Promise.all([
    d.orca.worktreePs({ agentWait: true }),
    d.orca.workerList({ limit: 100 }),
    d.orca.inbox({ limit: 100 }),
  ]);
  const workerRows = value(workers);
  const shows: Record<string, WorkerShow | null> = {};
  for (const w of workerRows?.rows.filter(isUnfinished) ?? []) {
    if (signal.aborted) break;
    shows[w.dispatchId] = value(await d.orca.workerShow({ dispatch: w.dispatchId }));
  }
  const gates: Record<string, GateRow[] | null> = {};
  for (const run of new Set(Object.values(shows).flatMap((s) => (s?.runId ? [s.runId] : [])))) {
    if (signal.aborted) break;
    gates[run] = value(await d.orca.gateList({ run }));
  }
  const events = EVENT_TYPES.flatMap((type) => d.events({ type }));
  return judgeOrca({ ps: value(ps), workers: workerRows, shows, gates, inbox: value(inbox), events }, d.now(), d.config);
}
