import type { OrcaSnapshot } from "../contract/views.ts";
import { pendingRereview, rereviewItem } from "../land/rereview.ts";
import type { CoreDeps } from "../notify/result.ts";
import { createItem } from "../start/item.ts";
import { addEdgeTo } from "./edit.ts";
import { foldFacts } from "./facts.ts";
import { itemRef } from "./nodes.ts";

// Decision 215 (G31): a PR whose base changed with no review recorded after it gets one re-review
// item, a `blocks` edge into the PR's item, in that item's Run. Land and the merge-ready report
// judge the review from the events themselves; the item is the work to do, not the gate.

export interface RereviewResult {
  /** `<pr> → iNNN` for each item made this call. */
  readonly made: readonly string[];
  readonly refused: readonly string[];
}

export async function rereviewItems(deps: CoreDeps, snapshot: OrcaSnapshot): Promise<RereviewResult> {
  const made: string[] = [];
  const refused: string[] = [];
  const events = deps.store.events();
  const facts = foldFacts(events);
  for (const pr of facts.prs.values()) {
    if (pr.merged || pr.closed) continue;
    const change = pendingRereview(events, pr.pr);
    if (!change || rereviewItem(events, pr.pr, change.seq)) continue;
    const owner = [...pr.tasks].map((t) => snapshot.tasks.find((x) => x.id === t)).find((t) => t !== undefined);
    if (!owner) {
      refused.push(`${pr.pr}: none of its items is in a Run read this round`);
      continue;
    }
    const who = events.find((e) => e.type === "item_created" && e.payload.task === owner.id)?.payload.who;
    const item = await createItem(deps.orca, deps.store, {
      run: owner.runId,
      title: `re-review ${pr.pr}`,
      spec: [
        `Re-review ${pr.pr}: its base moved from ${change.from} to ${change.to}, so the review recorded before that no longer counts.`,
        "Review the PR at its current head and record the verdict with review_record (CLI: sangsoe review record). Land and the merge-ready report hold until then.",
      ].join("\n"),
      who: typeof who === "string" ? who : "lead",
      doneWhen: `a review of ${pr.pr} recorded after its base moved to ${change.to}`,
    });
    if (!item.ok) {
      refused.push(`${pr.pr}: ${item.code} ${item.error}`);
      continue;
    }
    const edge = addEdgeTo(deps, snapshot, { pred: itemRef(item.task), succ: itemRef(owner.id), kind: "blocks" });
    if (!edge.ok) refused.push(`${pr.pr}: ${edge.refusal.code} ${edge.refusal.reason}`);
    else made.push(`${pr.pr} → ${item.alias}`);
  }
  return { made, refused };
}
