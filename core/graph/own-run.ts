import { pendingRereview, rereviewItem } from "../land/rereview.ts";
import type { CoreDeps } from "../notify/result.ts";
import type { Store } from "../store/store.ts";
import { readInput } from "./entry.ts";
import { foldFacts } from "./facts.ts";
import { type RereviewResult, rereviewItems } from "./rereview.ts";
import { type SyncResult, syncGraph } from "./sync.ts";

/**
 * The Runs a re-review item is still to be made in, from the store alone: an open PR whose latest base
 * change has neither a clean verdict nor its item yet, in the Run its own item was made in. One read
 * when no PR's base ever changed.
 */
export function rereviewRuns(store: Pick<Store, "events">): Set<string> {
  const runs = new Set<string>();
  if (store.events({ type: "pr_base_changed" }).length === 0) return runs;
  const events = store.events();
  const runOf = new Map(events.flatMap((e) => (e.type === "item_created" && typeof e.payload.run === "string" ? [[String(e.payload.task), e.payload.run] as const] : [])));
  for (const pr of foldFacts(events).prs.values()) {
    if (pr.merged || pr.closed) continue;
    const change = pendingRereview(events, pr.pr);
    if (!change || rereviewItem(events, pr.pr, change)) continue;
    for (const t of pr.tasks) {
      const run = runOf.get(t);
      if (run) runs.add(run);
    }
  }
  return runs;
}

export type OwnRunSync = { run: string; synced: SyncResult; rereview: RereviewResult } | { skipped: string };

/**
 * Decision 219: Orca lets only the session bound to a Run create Tasks on it, so that session's own
 * hook makes the Run's re-review items, the same calls `sangsoe graph sync --run <its Run>` makes. No
 * Orca call unless the store names a pending item; then one run-current, and the sync only when this
 * session is bound to a Run the item belongs in.
 */
export async function syncOwnRun(deps: CoreDeps, now: string): Promise<OwnRunSync> {
  const runs = rereviewRuns(deps.store);
  if (runs.size === 0) return { skipped: "nothing pending" };
  const current = await deps.orca.runCurrent();
  const run = current.ok && typeof current.value.runId === "string" ? current.value.runId : null;
  if (!run || !runs.has(run)) return { skipped: `pending in ${[...runs].join(", ")}, not this session's Run` };
  const input = await readInput(deps, [run], now);
  if (!input.ok) return { skipped: input.refusal.code };
  const synced = syncGraph(deps, input.value.orca, []);
  return { run, synced, rereview: await rereviewItems(deps, input.value.orca) };
}
