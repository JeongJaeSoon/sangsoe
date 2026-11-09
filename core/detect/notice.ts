import type { StoredEvent } from "../contract/index.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import { briefRuns } from "../brief/load.ts";
import { type NotifyInput, notify } from "../notify/notify.ts";
import type { MonitorDeps } from "./monitor.ts";

/**
 * The one way a monitor round sends a notice (decision 154): through core `notify`, so the order of
 * tiers and the once-per-key rule stay notify's. Without `d.core` (a dry run) nothing is sent.
 */
export async function sendNotice(d: Pick<MonitorDeps, "core">, input: NotifyInput): Promise<{ ok: boolean; detail: string }> {
  if (!d.core) return { ok: false, detail: "dry run: not sent" };
  const r = await notify(d.core, input);
  return r.ok ? { ok: true, detail: r.value.status } : { ok: false, detail: r.refusal.code };
}

/** Worker-list pages read at most to find the Dispatch running a Run's coordinator. */
const MAX_PAGES = 20;

export type RunAbove = (run: string) => Promise<string | undefined>;

/**
 * The Run of the session above `run`, read from Orca only (decision 154): `run-show --full` names the
 * terminal coordinating `run`; the Dispatch whose worker runs in that terminal belongs to the Run
 * above. No Dispatch, an unread page or a missing field is unknown. Memoized per call site; the
 * worker list is read lazily, once, and only when asked.
 */
export function runAbove(orca: OrcaAdapter): RunAbove {
  let byTerminal: Promise<Map<string, string> | undefined> | undefined;
  const memo = new Map<string, Promise<string | undefined>>();
  const terminals = async (): Promise<Map<string, string> | undefined> => {
    const out = new Map<string, string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await orca.workerList({ limit: 100, ...(cursor ? { cursor } : {}) });
      if (!r.ok) return undefined;
      for (const w of r.value.rows) if (w.terminal) out.set(w.terminal, w.dispatchId);
      cursor = r.value.nextCursor;
      if (!cursor) return out;
    }
    return out;
  };
  const find = async (run: string): Promise<string | undefined> => {
    const shown = await orca.runShow({ id: run });
    const handle = shown.ok ? shown.value.coordinatorHandle : undefined;
    if (!handle) return undefined;
    byTerminal ??= terminals();
    const dispatch = (await byTerminal)?.get(handle);
    if (!dispatch) return undefined;
    const w = await orca.workerShow({ dispatch });
    return w.ok && w.value.runId && w.value.runId !== run ? w.value.runId : undefined;
  };
  return (run) => {
    const p = memo.get(run) ?? find(run);
    memo.set(run, p);
    return p;
  };
}

/**
 * The orchestrator's Run when no lead Run is at hand (timer_stalled): the top of the chain above
 * every Run the store's events name. None, or two different tops, is unknown.
 */
export async function orchestratorRun(events: readonly StoredEvent[], above: RunAbove): Promise<string | undefined> {
  const tops = new Set<string>();
  for (const run of briefRuns(events, null)) {
    let top: string | undefined;
    for (let at: string | undefined = await above(run), depth = 0; at && depth < 5; at = await above(at), depth++) top = at;
    if (top) tops.add(top);
  }
  return tops.size === 1 ? [...tops][0] : undefined;
}
