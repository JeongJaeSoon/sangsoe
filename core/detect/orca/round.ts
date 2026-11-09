import type { GateRow, LocalRows, OrcaResult, WorkerRow, WorkerShow } from "../../contract/orca.ts";
import type { MonitorDeps, Reading } from "../monitor.ts";
import { isUnfinished, judgeOrca, ORCA_EVENT_TYPES } from "./judge.ts";

const value = <T>(r: OrcaResult<T>): T | null => (r.ok ? r.value : null);

const MAX_WORKER_PAGES = 10;

// Every page of worker-list: run_stalled needs a Run's whole membership. Pages left unread keep
// `truncated`, which the judgment treats as membership unknown.
async function allWorkers(d: MonitorDeps, signal: AbortSignal): Promise<LocalRows<WorkerRow> | null> {
  const first = value(await d.orca.workerList({ limit: 100 }));
  if (!first) return null;
  let page: LocalRows<WorkerRow> = first;
  const rows = new Map(page.rows.map((w) => [w.dispatchId, w]));
  const omitted = new Set(page.omittedHostIds);
  let nonLocal = page.nonLocal.rows;
  const hostIds = new Set(page.nonLocal.hostIds);
  const cursors = new Set<string>();
  for (let n = 1; page.nextCursor && !cursors.has(page.nextCursor) && n < MAX_WORKER_PAGES && !signal.aborted; n++) {
    cursors.add(page.nextCursor);
    const next: LocalRows<WorkerRow> | null = value(await d.orca.workerList({ limit: 100, cursor: page.nextCursor }));
    if (!next) break;
    page = next;
    for (const w of next.rows) rows.set(w.dispatchId, w);
    for (const h of next.omittedHostIds) omitted.add(h);
    nonLocal += next.nonLocal.rows;
    for (const h of next.nonLocal.hostIds) hostIds.add(h);
  }
  return {
    rows: [...rows.values()],
    nonLocal: { rows: nonLocal, hostIds: [...hostIds] },
    omittedHostIds: [...omitted],
    truncated: page.truncated,
  };
}

/**
 * One orca-monitor round: Orca reads through the adapter only, mail through `inbox`, which never
 * marks it handled; then the pure judgment. Rows of other hosts never reach it (decision 88 ①).
 */
export async function orcaRound(d: MonitorDeps, signal: AbortSignal): Promise<Reading> {
  const [ps, workerRows, inbox] = await Promise.all([
    d.orca.worktreePs({ agentWait: true }),
    allWorkers(d, signal),
    d.orca.inbox({ limit: 100 }),
  ]);
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
  const events = ORCA_EVENT_TYPES.flatMap((type) => d.events({ type }));
  return judgeOrca({ ps: value(ps), workers: workerRows, shows, gates, inbox: value(inbox), events }, d.now(), d.config);
}
