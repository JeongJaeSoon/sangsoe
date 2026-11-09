import { capacity, judgeLoad, type LoadSample, sampleLoad } from "../capacity/capacity.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import type { Store } from "../store/store.ts";
import { findKey } from "./start.ts";

export type NewItem = {
  run: string;
  spec: string;
  title?: string;
  deps?: string[];
  who: string;
  doneWhen: string;
};

export type ItemCreated = { ok: true; task: string; alias: string } | { ok: false; error: string };

/**
 * An item is an Orca Task (decision 74): task-create --deps, then one `item_created` row binding
 * its iNNN alias. The Task's spec, title and deps stay in Orca only. Starting it is startUnit's.
 */
export async function createItem(orca: OrcaAdapter, store: Pick<Store, "append" | "allocate">, a: NewItem): Promise<ItemCreated> {
  const args = { spec: a.spec, run: a.run, ...(a.title ? { title: a.title } : {}), ...(a.deps?.length ? { deps: a.deps } : {}) };
  const r = await orca.taskCreate(args);
  if (!r.ok) return { ok: false, error: `task-create 실패 (${r.error.code}: ${r.error.message})` };
  const task = findKey(r.value, ["taskId", "task_id"]) ?? findKey((r.value as { task?: unknown }).task, ["id"]);
  if (!task) return { ok: false, error: "task-create 영수증에 Task id 가 없다" };
  const alias = store.allocate("i");
  store.append({
    type: "item_created",
    source: "core:item",
    payload: { task, alias, who: a.who, done_when: a.doneWhen, owner_action: 0 },
    entity: "task",
    entity_id: task,
  });
  return { ok: true, task, alias };
}

/** Free slots on a Run: live workers against `limit`, with the one load judgment (decision 83). */
export async function runSlots(orca: OrcaAdapter, run: string, limit: number, sample: LoadSample = sampleLoad()): Promise<number> {
  const w = await orca.workerList({ run, limit: 100 });
  if (!w.ok) return 0;
  const live = w.value.rows.filter((r) => r.liveness === "live" && r.state !== "settled").length;
  return capacity({ live, limit, level: judgeLoad(sample).level });
}
