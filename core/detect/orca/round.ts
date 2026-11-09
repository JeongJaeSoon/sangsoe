import type { GateRow, LocalRows, OrcaResult, WorkerRow, WorkerShow } from "../../contract/orca.ts";
import type { MonitorDeps, Reading } from "../monitor.ts";
import { isUnfinished, judgeOrca, ORCA_EVENT_TYPES } from "./judge.ts";

const value = <T>(r: OrcaResult<T>): T | null => (r.ok ? r.value : null);

// worker-list without --run spans every Run, newest first, settled Dispatches included: a few
// pages find the Runs in flight. A Run's own list is read to the end, since run_stalled needs all
// of its members.
const GLOBAL_PAGES = 3;
const RUN_PAGES = 10;

async function pages(d: MonitorDeps, signal: AbortSignal, max: number, run?: string): Promise<LocalRows<WorkerRow> | null> {
  const ask = (cursor?: string) =>
    d.orca.workerList({ limit: 100, ...(run ? { run } : {}), ...(cursor ? { cursor } : {}) }).then(value);
  const first = await ask();
  if (!first) return null;
  let page: LocalRows<WorkerRow> = first;
  let truncated = first.truncated && !first.nextCursor;
  const rows = new Map(page.rows.map((w) => [w.dispatchId, w]));
  const omitted = new Set(page.omittedHostIds);
  let nonLocal = page.nonLocal.rows;
  const hostIds = new Set(page.nonLocal.hostIds);
  const cursors = new Set<string>();
  for (let n = 1; page.nextCursor && !cursors.has(page.nextCursor) && n < max && !signal.aborted; n++) {
    cursors.add(page.nextCursor);
    const next = await ask(page.nextCursor);
    if (!next) break;
    page = next;
    truncated ||= next.truncated && !next.nextCursor;
    for (const w of next.rows) rows.set(w.dispatchId, w);
    for (const h of next.omittedHostIds) omitted.add(h);
    nonLocal += next.nonLocal.rows;
    for (const h of next.nonLocal.hostIds) hostIds.add(h);
  }
  return {
    rows: [...rows.values()],
    nonLocal: { rows: nonLocal, hostIds: [...hostIds] },
    omittedHostIds: [...omitted],
    // A next page left unread, or a page that said it held back rows without a cursor.
    truncated: truncated || page.nextCursor !== undefined,
  };
}

/**
 * One orca-monitor round: Orca reads through the adapter only, mail through `inbox`, which never
 * marks it handled; then the pure judgment. Rows of other hosts never reach it (decision 88 ①).
 */
export async function orcaRound(d: MonitorDeps, signal: AbortSignal): Promise<Reading> {
  const [ps, workerRows, inbox] = await Promise.all([
    d.orca.worktreePs({ agentWait: true }),
    pages(d, signal, GLOBAL_PAGES),
    d.orca.inbox({ limit: 100 }),
  ]);
  const shows: Record<string, WorkerShow | null> = {};
  for (const w of workerRows?.rows.filter(isUnfinished) ?? []) {
    if (signal.aborted) break;
    shows[w.dispatchId] = value(await d.orca.workerShow({ dispatch: w.dispatchId }));
  }
  const runs: Record<string, LocalRows<WorkerRow> | null> = {};
  const gates: Record<string, GateRow[] | null> = {};
  for (const run of new Set(Object.values(shows).flatMap((s) => (s?.runId ? [s.runId] : [])))) {
    if (signal.aborted) break;
    runs[run] = await pages(d, signal, RUN_PAGES, run);
    gates[run] = value(await d.orca.gateList({ run }));
  }
  const events = ORCA_EVENT_TYPES.flatMap((type) => d.events({ type }));
  return judgeOrca({ ps: value(ps), workers: workerRows, shows, runs, gates, inbox: value(inbox), events }, d.now(), d.config);
}
