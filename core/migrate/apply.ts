import { decisionOpen } from "../decision/open.ts";
import { addEdgeTo } from "../graph/edit.ts";
import { itemRef } from "../graph/nodes.ts";
import { readSnapshot } from "../graph/snapshot.ts";
import { type CoreDeps, done, type Result, refuse } from "../notify/result.ts";
import { createItem } from "../start/item.ts";
import { importedFrom, planImport } from "./plan.ts";
import type { OldState } from "./source.ts";

type Tally = { items: number; decisions: number; edges: number };

export interface ImportResult {
  readonly created: Tally;
  readonly already: Tally;
  /** Old item id → its Orca Task. */
  readonly tasks: Readonly<Record<string, string>>;
}

const SOURCE = "core:migrate";
const RESUME = "fix the cause and run `sangsoe migrate --apply` again with the same --run: what was made is skipped";

/**
 * Writes the plan through the core functions only: createItem, item_extra_set, GRAPH and decisionOpen.
 * Stops at the first refusal; a re-run finds what was made by its request-id link and skips it.
 */
export async function applyImport(deps: CoreDeps, old: OldState, o: { run: string }): Promise<Result<ImportResult>> {
  if (o.run.trim() === "") return refuse("invalid_input", "the import needs the Run its Tasks go in", "pass --run <run id>");
  const plan = planImport(old, importedFrom(deps.store));
  // Read before any create, as expandFlow does: a read failing after the creates would leave the edges out.
  const needEdges = plan.edges.some((e) => e.action === "create");
  const snap = needEdges ? await readSnapshot(deps.orca, [o.run]) : undefined;
  if (snap && snap.unread.length > 0) return refuse("orca_unreadable", `task-list ${o.run} failed`, RESUME);

  const created: Tally = { items: 0, decisions: 0, edges: 0 };
  const already: Tally = { items: 0, decisions: 0, edges: 0 };
  const tasks: Record<string, string> = {};
  for (const p of plan.items) {
    if (p.task) {
      tasks[p.id] = p.task;
      already.items++;
      continue;
    }
    const r = await createItem(deps.orca, deps.store, { run: o.run, ...p.create });
    if (!r.ok) return refuse(r.code, `item ${p.id}: ${r.error}`, RESUME);
    deps.store.append({ type: "item_extra_set", source: SOURCE, payload: { task: r.task, ...p.extra } });
    tasks[p.id] = r.task;
    created.items++;
  }
  for (const e of plan.edges) {
    if (e.action === "already" || !snap) {
      already.edges++;
      continue;
    }
    const w = addEdgeTo(deps, snap.snapshot, { pred: itemRef(tasks[e.pred] as string), succ: itemRef(tasks[e.succ] as string), kind: e.kind });
    if (!w.ok) return refuse(w.refusal.code, `edge ${e.pred} → ${e.succ}: ${w.refusal.reason}`, RESUME);
    if (w.value.status === "added") created.edges++;
    else already.edges++;
  }
  for (const d of plan.decisions) {
    if (d.action === "already") {
      already.decisions++;
      continue;
    }
    const r = await decisionOpen(deps, { subject: d.subject, options: d.options, question: d.question, waiters: [], carrierRun: o.run, callerRun: o.run });
    if (!r.ok) return refuse(r.refusal.code, `decision ${d.id}: ${r.refusal.reason}`, RESUME);
    if (r.value.status === "opened") created.decisions++;
    else already.decisions++;
  }
  return done({ created, already, tasks });
}
