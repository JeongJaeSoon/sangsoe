import { sampleLoad } from "../capacity/capacity.ts";
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
  type Reading,
  type Written,
} from "./monitor.ts";
import { orcaRound } from "./orca/round.ts";
import { resourceRound } from "./resource/round.ts";

/** The one table both entrances run: the worker's timer rounds and `sangsoe monitor run <name>`. */
export const MONITORS: Record<MonitorName, (d: MonitorDeps, signal: AbortSignal) => Promise<Reading>> = {
  orca: orcaRound,
  resource: resourceRound,
  chat: chatRound,
};

/** One round: read and judge, then append each planned event unless the round passed its cap. */
export async function runMonitor(name: MonitorName, d: MonitorDeps, signal: AbortSignal = new AbortController().signal): Promise<MonitorReport> {
  const { planned, unseen } = await MONITORS[name](d, signal);
  const written: Written[] = [];
  if (d.append && !signal.aborted) {
    for (const e of planned) {
      const a = d.append(e);
      written.push({ type: e.type, dedupe_key: e.dedupe_key ?? null, seq: a.seq, inserted: a.inserted });
    }
  }
  return { monitor: name, planned, written, unseen, aborted: signal.aborted };
}

export type MonitorRunner = {
  run(name: MonitorName, signal?: AbortSignal): Promise<MonitorReport>;
  close(): void;
};

/** Real deps over one open store. `dryRun` reads the store but never appends. */
export function openMonitors(o: { dryRun?: boolean; dbPath?: string } = {}): MonitorRunner {
  const store = Store.open(o.dbPath ? { path: o.dbPath } : {});
  const exec = nodeExec(30_000);
  const deps: MonitorDeps = {
    orca: createOrcaAdapter(exec),
    exec,
    events: (f) => store.events(f),
    ...(o.dryRun ? {} : { append: (e) => store.append(e) }),
    now: () => Date.now(),
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => sampleLoad(),
  };
  return { run: (name, signal) => runMonitor(name, deps, signal), close: () => store.close() };
}
