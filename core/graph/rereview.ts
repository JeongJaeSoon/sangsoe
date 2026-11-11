import type { OrcaSnapshot } from "../contract/views.ts";
import { pendingRereview, rereviewDoneWhen, rereviewItem } from "../land/rereview.ts";
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

/** The PR item's extras the re-review item takes, so it sits in the same group and repo. */
const CARRIED = ["lead", "priority", "repo"] as const;

export async function rereviewItems(deps: CoreDeps, snapshot: OrcaSnapshot): Promise<RereviewResult> {
  const made: string[] = [];
  const refused: string[] = [];
  const events = deps.store.events();
  const facts = foldFacts(events);
  for (const pr of facts.prs.values()) {
    // A PR bound to no item has no item to block.
    if (pr.merged || pr.closed || pr.tasks.size === 0) continue;
    const change = pendingRereview(events, pr.pr);
    if (!change) continue;
    const bound = [...pr.tasks].flatMap((t) => snapshot.tasks.filter((x) => x.id === t));
    const owner = bound[0];
    if (!owner) {
      refused.push(`${pr.pr}: none of its items is in a Run read this round`);
      continue;
    }
    let item = rereviewItem(events, pr.pr, change);
    if (!item) {
      const who = events.find((e) => e.type === "item_created" && e.payload.task === owner.id)?.payload.who;
      const created = await createItem(deps.orca, deps.store, {
        run: owner.runId,
        title: `re-review ${pr.pr}`,
        spec: [
          `Re-review ${pr.pr}: its base moved from ${change.from} to ${change.to}, so the review recorded before that no longer counts.`,
          "Review the PR at its current head and record the verdict with review_record (CLI: sangsoe review record). Land and the merge-ready report hold until then.",
          "Then call land on the PR again: it re-judges the PR at its new base.",
        ].join("\n"),
        who: typeof who === "string" ? who : "lead",
        doneWhen: rereviewDoneWhen(pr.pr, change),
      });
      if (!created.ok) {
        refused.push(`${pr.pr}: ${created.code} ${created.error}`);
        continue;
      }
      item = created;
      const extras: Record<string, unknown> = {};
      for (const e of events) {
        if (e.type !== "item_extra_set" || e.payload.task !== owner.id) continue;
        for (const k of CARRIED) if (e.payload[k] !== undefined) extras[k] = e.payload[k];
      }
      if (Object.keys(extras).length > 0) {
        deps.store.append({ type: "item_extra_set", source: "core:item", payload: { task: item.task, ...extras }, entity: "task", entity_id: item.task });
      }
      made.push(`${pr.pr} → ${item.alias}`);
    }
    // One edge into each of the PR's items, added until it is written once, so a round that stopped
    // after the item still links it; an edge the lead removed stays removed.
    const pred = itemRef(item.task);
    for (const t of bound) {
      const succ = itemRef(t.id);
      if (events.some((e) => e.type === "edge_added" && e.payload.pred === pred && e.payload.succ === succ)) continue;
      const edge = addEdgeTo(deps, snapshot, { pred, succ, kind: "blocks" });
      if (!edge.ok) refused.push(`${pr.pr}: ${edge.refusal.code} ${edge.refusal.reason}`);
    }
  }
  return { made, refused };
}
