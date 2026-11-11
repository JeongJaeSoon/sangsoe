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
  // A refusal keeps Orca's code and message (in the reason), so probe.report shows why a wake failed (decision 219).
  return r.ok ? { ok: true, detail: r.value.status } : { ok: false, detail: `${r.refusal.code}: ${r.refusal.reason}` };
}

/** Worker-list pages read at most to find the Dispatch running a Run's coordinator. */
const MAX_PAGES = 20;

/** `top`: Orca was read in full and no Dispatch runs the Run's coordinator. `unknown`: something was not read. */
export type Above = { kind: "above"; run: string } | { kind: "top" } | { kind: "unknown" };
export type RunAbove = (run: string) => Promise<Above>;

const UNKNOWN: Above = { kind: "unknown" };
/** A terminal two Dispatches name cannot say which Run is above. */
const AMBIGUOUS = "";

/**
 * The Run of the session above `run`, read from Orca only (decision 154): `run-show --full` names the
 * terminal coordinating `run`; the Dispatch whose worker runs in that terminal belongs to the Run
 * above. A failed read, a missing field, a list cut short or missing another host's rows, or a
 * terminal two Dispatches name is unknown, never `top`. Memoized per call site; the worker list is
 * read lazily, once, and only when asked.
 */
export function runAbove(orca: OrcaAdapter): RunAbove {
  let byTerminal: Promise<Map<string, string> | undefined> | undefined;
  const memo = new Map<string, Promise<Above>>();
  const terminals = async (): Promise<Map<string, string> | undefined> => {
    const out = new Map<string, string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await orca.workerList({ limit: 100, ...(cursor ? { cursor } : {}) });
      if (!r.ok || r.value.nonLocal.rows > 0 || r.value.omittedHostIds.length > 0) return undefined;
      for (const w of r.value.rows) if (w.terminal) out.set(w.terminal, out.has(w.terminal) ? AMBIGUOUS : w.dispatchId);
      cursor = r.value.nextCursor;
      if (!cursor) return out;
    }
    return undefined;
  };
  const find = async (run: string): Promise<Above> => {
    const shown = await orca.runShow({ id: run });
    const handle = shown.ok ? shown.value.coordinatorHandle : undefined;
    if (!handle) return UNKNOWN;
    byTerminal ??= terminals();
    const map = await byTerminal;
    if (!map) return UNKNOWN;
    const dispatch = map.get(handle);
    if (dispatch === undefined) return { kind: "top" };
    if (dispatch === AMBIGUOUS) return UNKNOWN;
    const w = await orca.workerShow({ dispatch });
    return w.ok && w.value.runId && w.value.runId !== run ? { kind: "above", run: w.value.runId } : UNKNOWN;
  };
  return (run) => {
    const p = memo.get(run) ?? find(run);
    memo.set(run, p);
    return p;
  };
}

const MAX_DEPTH = 5;

/**
 * The orchestrator's Run when no lead Run is at hand (timer_stalled): the top of the chain above
 * every Run the store's events name. Any hop unknown, a chain past the depth cap, no top, or two
 * different tops is unknown.
 */
export async function orchestratorRun(events: readonly StoredEvent[], above: RunAbove): Promise<string | undefined> {
  const tops = new Set<string>();
  for (const run of briefRuns(events, null)) {
    let at = run;
    let a = await above(at);
    for (let depth = 0; a.kind === "above"; depth++) {
      if (depth >= MAX_DEPTH) return undefined;
      at = a.run;
      a = await above(at);
    }
    if (a.kind === "unknown") return undefined;
    if (at !== run) tops.add(at);
  }
  return tops.size === 1 ? [...tops][0] : undefined;
}
