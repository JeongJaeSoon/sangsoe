import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { sampleLoad } from "../capacity/capacity.ts";
import { DEFAULT_MONITOR_CONFIG } from "../detect/monitor.ts";
import { createGhClient, memoryGhCache } from "../gh/client.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import { holdStore } from "../store/held.ts";
import { Store } from "../store/store.ts";
import { readReaperConfig } from "./config.ts";
import {
  type OwnerReap,
  type OwnerReaped,
  ownerReap,
  type ResourceDeps,
  type ResourcePart,
  type ResourcePartView,
  type ResourceView,
  readResourcePart,
  readResources,
  sangsoeWorktrees,
  TRASH_BIN,
} from "./resources.ts";
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

/** Decision 234: the panel's 리소스 read and its confirmed 정리, over the same REAPER and store. */
export function openResources(o: { dbPath?: string; home?: string } = {}) {
  const exec = nodeExec(60_000);
  const base = { exec, now: () => Date.now(), tmpRoot: tmpdir(), uid: process.getuid?.() ?? -1, trashBin: existsSync(TRASH_BIN) ? TRASH_BIN : null };
  const withRunner = async <T>(dryRun: boolean, fn: (r: ReaperRunner) => Promise<T>): Promise<T> => {
    const runner = openReaper({ ...o, dryRun });
    try {
      return await fn(runner);
    } finally {
      runner.close();
    }
  };
  const reading = <T>(fn: (d: ResourceDeps) => Promise<T>): Promise<T> =>
    withRunner(true, (plan) => {
      const store = Store.open(o.dbPath ? { path: o.dbPath } : {});
      return fn({
        ...base,
        orca: createOrcaAdapter(exec),
        events: (f) => store.events(f),
        sample: () => sampleLoad(),
        samples: (since) => store.loadSamples(since),
        plan: (opts) => plan.run(opts),
      }).finally(() => store.close());
    });
  return {
    read: (): Promise<ResourceView> => reading(readResources),
    /** Decision 235: one part, so the panel paints each as it comes. */
    part: (p: ResourcePart): Promise<ResourcePartView> => reading((d) => readResourcePart(d, p)),
    reap: (a: OwnerReap): Promise<OwnerReaped> =>
      withRunner(false, (runner) =>
        ownerReap(
          {
            ...base,
            run: (opts) => runner.run(opts),
            mine: () => {
              const store = Store.open(o.dbPath ? { path: o.dbPath } : {});
              return sangsoeWorktrees((f) => store.events(f), createOrcaAdapter(exec)).finally(() => store.close());
            },
          },
          a,
        ),
      ),
  };
}
