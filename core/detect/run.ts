import { sampleLoad } from "../capacity/capacity.ts";
import { createGhClient, memoryGhCache } from "../gh/client.ts";
import { readLandConfig } from "../land/ports.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import { holdStore } from "../store/held.ts";
import { Store } from "../store/store.ts";
import { VERSION } from "../version.ts";
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
import { queueRound, type StallReport, stallCheck } from "./queue/round.ts";
import { hostRereadPending } from "../store/backup.ts";
import { rereadHostRows } from "./rebuild.ts";
import { resourceRound } from "./resource/round.ts";

/** The one table both entrances run: the worker's timer rounds and `sangsoe monitor run <name>`. */
export const MONITORS: Record<MonitorName, (d: MonitorDeps, signal: AbortSignal) => Promise<Reading>> = {
  orca: orcaRound,
  resource: resourceRound,
  chat: chatRound,
  pr: prRound,
  queue: queueRound,
};

/**
 * One round: read and judge, append each planned event unless the round passed its cap, then run
 * the round's Orca writes in order, each followed by the events it returned. A dry run does neither.
 */
export async function runMonitor(name: MonitorName, d: MonitorDeps, signal: AbortSignal = new AbortController().signal): Promise<MonitorReport> {
  const { planned, unseen, acts = [], calls = [] } = await MONITORS[name](d, signal);
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
  return { monitor: name, planned, written, unseen, calls, aborted: signal.aborted, acts: report };
}

export type MonitorRunner = {
  run(name: MonitorName, signal?: AbortSignal): Promise<MonitorReport>;
  /** The timer-stall check; the worker calls it on Orca events and panel refreshes. */
  stall(): Promise<StallReport>;
  close(): void;
};

/**
 * Real deps over one held store, opened again when its file changes (decision 191). `dryRun` reads
 * the store but never appends, writes to Orca nor calls a writing function.
 */
export function openMonitors(o: { dryRun?: boolean; dbPath?: string; home?: string } = {}): MonitorRunner {
  const exec = nodeExec(30_000);
  const orca = createOrcaAdapter(exec);
  // One cache and one start time for the runner's life, so the budget carries from round to round.
  const ghCache = memoryGhCache();
  const openedAt = Date.now();
  const held = holdStore(
    () => Store.open(o.dbPath ? { path: o.dbPath } : o.home ? { home: o.home } : {}),
    (store) => {
      const deps: MonitorDeps = {
        orca,
        exec,
        events: (f) => store.events(f),
        ...(o.dryRun ? {} : { append: (e) => store.append(e), core: { store, orca } }),
        now: () => Date.now(),
        openedAt,
        config: DEFAULT_MONITOR_CONFIG,
        chat: nullChatProvider,
        sample: () => sampleLoad(),
        gh: createGhClient({ exec, cache: ghCache, now: () => Date.now() }),
        ghBudget: () => ghCache.budget("core"),
        watch: () => readWatchConfig(o.home),
        tier: () => readLandConfig(o.home).tier,
        coreVersion: VERSION,
      };
      return { deps, run: afterHostReread(deps, () => !o.dryRun && hostRereadPending(store.events({ type: "signal" }))) };
    },
  );
  return {
    run: (name, signal) => held.use((b) => b.run(name, signal)),
    stall: () => held.use((b) => stallCheck(b.deps)),
    close: () => held.close(),
  };
}

/**
 * After a lost database, the first round of a runner waits for one reread of the host rows, so
 * the rounds after it see those rows as known and act only on what is new (decision 184). A reread
 * another caller aborted is started again under this caller's signal; a caller aborted before the
 * reread completes runs no round.
 */
export function afterHostReread(deps: MonitorDeps, pending: () => boolean): MonitorRunner["run"] {
  let reread: Promise<unknown> | null = null;
  const firstReread = async (signal?: AbortSignal): Promise<boolean> => {
    while (pending()) {
      if (signal?.aborted) return false;
      const mine = reread === null;
      reread ??= rereadHostRows(deps, signal).finally(() => {
        reread = null;
      });
      await reread;
      // Our own reread ran to its end and still left it owed (no `append`): stop rather than spin.
      if (mine && pending()) return false;
    }
    return true;
  };
  return async (name, signal) => {
    if (await firstReread(signal)) return runMonitor(name, deps, signal);
    return { monitor: name, planned: [], written: [], unseen: ["host rows not read again yet"], calls: [], aborted: true, acts: [] };
  };
}
