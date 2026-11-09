import { sampleLoad } from "../capacity/capacity.ts";
import { createGhClient, memoryGhCache } from "../gh/client.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import { Store } from "../store/store.ts";
import { readReaperConfig } from "./config.ts";
import { type ReapOptions, type ReapReport, reapRound } from "./round.ts";

export type ReaperRunner = { run(o?: ReapOptions): Promise<ReapReport>; close(): void };

/** Real deps over one open store: the worker's timer round and `sangsoe reap run` both use this. */
export function openReaper(o: { dryRun?: boolean; dbPath?: string; home?: string } = {}): ReaperRunner {
  const store = Store.open(o.dbPath ? { path: o.dbPath } : {});
  const exec = nodeExec(60_000);
  const run = (opts: ReapOptions = {}) =>
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
      },
      opts,
    );
  return { run, close: () => store.close() };
}
