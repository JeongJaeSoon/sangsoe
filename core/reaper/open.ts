import { sampleLoad } from "../capacity/capacity.ts";
import { DEFAULT_MONITOR_CONFIG } from "../detect/monitor.ts";
import { createGhClient, memoryGhCache } from "../gh/client.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import { holdStore } from "../store/held.ts";
import { Store } from "../store/store.ts";
import { readReaperConfig } from "./config.ts";
import { type ReapOptions, type ReapReport, reapRound } from "./round.ts";

export type ReaperRunner = { run(o?: ReapOptions): Promise<ReapReport>; close(): void };

/**
 * Real deps over one held store, opened again when its file changes (decision 191): the worker's
 * timer round and `sangsoe reap run` both use this.
 */
export function openReaper(o: { dryRun?: boolean; dbPath?: string; home?: string } = {}): ReaperRunner {
  const held = holdStore(() => Store.open(o.dbPath ? { path: o.dbPath } : {}), (store) => store);
  const exec = nodeExec(60_000);
  const run = (opts: ReapOptions = {}) =>
    held.use((store) =>
      reapRound(
        {
          orca: createOrcaAdapter(exec),
          gh: createGhClient({ exec, cache: memoryGhCache(), now: () => Date.now() }),
          exec,
          events: (f) => store.events(f),
          ...(o.dryRun ? {} : { append: (e) => store.append(e) }),
          now: () => Date.now(),
          config: readReaperConfig(o.home),
          sample: () => sampleLoad(),
          intervalMs: DEFAULT_MONITOR_CONFIG.reaperIntervalMinutes * 60_000,
        },
        opts,
      ),
    );
  return { run, close: () => held.close() };
}
