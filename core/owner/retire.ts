import { dedupeKey, EVENTS } from "../contract/index.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import { foldFacts } from "../graph/facts.ts";
import { holdOf } from "../graph/ready.ts";
import { readSnapshot } from "../graph/snapshot.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import type { Store } from "../store/store.ts";

export interface RetireInput {
  /** iNNN or the Task id. */
  readonly item: string;
  readonly reason: string;
  /** Who retires it: the owner or a lead (`lead:<name>`). */
  readonly by: string;
  /** The item's Run, for an item made before item_created named it (decision 216). */
  readonly run?: string;
}

export interface Retired {
  readonly status: "retired" | "already";
  readonly task: string;
  readonly alias: string;
}

/**
 * Decision 223: `item_retire` / `sangsoe item retire`. Only an item whose Task Orca shows completed and
 * whose PR closed without a merge is retirable; the row reads it 🗑️ and Orca is never written.
 */
export async function retireItem(ports: { readonly orca: OrcaAdapter; readonly store: Store }, a: RetireInput): Promise<Result<Retired>> {
  if (a.reason.trim() === "" || a.by.trim() === "") return refuse("invalid_input", "retiring an item needs a reason and who retires it", "pass reason and by (owner or lead:<name>)");
  const events = ports.store.events();
  const facts = foldFacts(events);
  const task = facts.aliases.get(a.item) ?? a.item;
  const alias = facts.items.get(task)?.alias;
  if (alias === undefined) return refuse("not_found", `no item ${a.item}`, "name an item by its iNNN or Task id");
  if (facts.items.get(task)?.retired) {
    // The row stands only while its PRs stay closed unmerged (retiredOf): a reopened or merged one is read as it is.
    const live = [...facts.prs.values()].filter((p) => p.tasks.has(task) && (p.merged || !p.closed)).map((p) => p.pr);
    if (live.length === 0) return done({ status: "already", task, alias });
    return refuse("not_retirable", `${alias} was retired, but ${live.join(", ")} is no longer closed unmerged`, "the item reads by that PR again; retire it once the PR closes without a merge");
  }

  const created = events.find((e) => e.type === "item_created" && e.payload.task === task);
  const run = typeof created?.payload.run === "string" ? created.payload.run : a.run;
  if (!run) return refuse("invalid_input", `${alias}'s item_created names no Run`, "pass run: the Run the item's Task is in");
  const snap = await readSnapshot(ports.orca, [run]);
  if (snap.unread.length > 0) return refuse("orca_unreadable", `task-list failed: ${snap.unread.map((u) => `${u.run} ${u.error}`).join("; ")}`, "retry once Orca answers");
  const t = snap.snapshot.tasks.find((x) => x.id === task);
  if (!t) return refuse("not_found", `Run ${run} has no Task ${task}`, "pass the Run the item's Task is in");

  const hold = holdOf(t, facts, []);
  if (hold?.by !== "pr" || hold.state !== "closed_unmerged") {
    return refuse(
      "not_retirable",
      `${alias} is not completed with its PR closed unmerged (Task ${t.status}${hold?.by === "pr" ? `, PR ${hold.state}` : ""})`,
      "only an item that reads 🚧 PR 이 머지 없이 닫힘 is retired; an open item is cancelled in Orca, an open PR is merged or closed first",
    );
  }
  const row = ports.store.append({
    type: "item_retired",
    source: "core:item",
    entity: "task",
    entity_id: task,
    dedupe_key: dedupeKey(EVENTS.item_retired, task),
    payload: { task, by: a.by, reason: a.reason },
  });
  return done({ status: row.inserted ? "retired" : "already", task, alias });
}
