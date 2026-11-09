import { sampleLoad } from "../capacity/capacity.ts";
import { createGhClient, memoryGhCache } from "../gh/client.ts";
import { readLandConfig } from "../land/ports.ts";
import { notify } from "../notify/notify.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import { Store } from "../store/store.ts";
import { nullChatProvider } from "./chat/provider.ts";
import { chatRound } from "./chat/round.ts";
import {
  DEFAULT_MONITOR_CONFIG,
  type MonitorDeps,
  type MonitorName,
  type MonitorReport,
  type Planned,
  type Reading,
  type Written,
} from "./monitor.ts";
import { orcaRound } from "./orca/round.ts";
import { readWatchConfig } from "./pr/config.ts";
import { prRound } from "./pr/round.ts";
import { resourceRound } from "./resource/round.ts";

/** The one table both entrances run: the worker's timer rounds and `sangsoe monitor run <name>`. */
export const MONITORS: Record<MonitorName, (d: MonitorDeps, signal: AbortSignal) => Promise<Reading>> = {
  orca: orcaRound,
  resource: resourceRound,
  chat: chatRound,
  pr: prRound,
};

/**
 * One round: read and judge, append each planned event unless the round passed its cap, then run
 * the round's Orca writes in order, each followed by the events it returned. A dry run does neither.
 */
export async function runMonitor(name: MonitorName, d: MonitorDeps, signal: AbortSignal = new AbortController().signal): Promise<MonitorReport> {
  const { planned, unseen, acts = [] } = await MONITORS[name](d, signal);
  const written: Written[] = [];
  const write = (e: Planned) => {
    if (!d.append) return;
    const a = d.append(e);
    written.push({ type: e.type, dedupe_key: e.dedupe_key ?? null, seq: a.seq, inserted: a.inserted });
  };
  const report: MonitorReport["acts"] = acts.map((a) => ({ what: a.what, ok: null, detail: "not run" }));
  if (d.append && !signal.aborted) {
    for (const e of planned) write(e);
    for (const [i, act] of acts.entries()) {
      if (signal.aborted) break;
      const r = await act.run(d);
      report[i] = { what: act.what, ok: r.ok, detail: r.detail };
      for (const e of r.planned) write(e);
    }
  }
  return { monitor: name, planned, written, unseen, aborted: signal.aborted, acts: report };
}

export type MonitorRunner = {
  run(name: MonitorName, signal?: AbortSignal): Promise<MonitorReport>;
  close(): void;
};

/** Real deps over one open store. `dryRun` reads the store but never appends nor writes to Orca. */
export function openMonitors(o: { dryRun?: boolean; dbPath?: string; home?: string } = {}): MonitorRunner {
  const store = Store.open(o.dbPath ? { path: o.dbPath } : o.home ? { home: o.home } : {});
  const exec = nodeExec(30_000);
  const orca = createOrcaAdapter(exec);
  // One cache for the runner's life, so the budget carries from round to round.
  const ghCache = memoryGhCache();
  const deps: MonitorDeps = {
    orca,
    exec,
    events: (f) => store.events(f),
    ...(o.dryRun ? {} : { append: (e) => store.append(e), notify: (input) => notify({ store, orca }, input) }),
    now: () => Date.now(),
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => sampleLoad(),
    gh: createGhClient({ exec, cache: ghCache, now: () => Date.now() }),
    ghBudget: () => ghCache.budget("core"),
    watch: () => readWatchConfig(o.home),
    tier: () => readLandConfig(o.home).tier,
  };
  return { run: (name, signal) => runMonitor(name, deps, signal), close: () => store.close() };
}
