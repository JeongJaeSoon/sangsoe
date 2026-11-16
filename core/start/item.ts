import { capacity, judgeLoad, type LoadSample, sampleLoad } from "../capacity/capacity.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import { settled } from "../recover/recover.ts";
import type { Store } from "../store/store.ts";
import { findKey, roleLine } from "./start.ts";

export type NewItem = {
  run: string;
  spec: string;
  title?: string;
  deps?: string[];
  /** The parent Task (`task-create --parent`): a flow template's root, for its steps. */
  parent?: string;
  who: string;
  doneWhen: string;
  /** The role of the session that will work it; its role line goes first in the spec. Default worker. */
  role?: "lead" | "worker";
};

export type ItemCreated =
  | { ok: true; task: string; alias: string }
  | { ok: false; code: "invalid_input" | "task_create_failed"; error: string; orcaCode?: string };

const REQUIRED = ["run", "spec", "who", "doneWhen"] as const;

/**
 * An item is an Orca Task (decision 74): task-create --deps, then one `item_created` row binding
 * its iNNN alias. The Task's spec, title and deps stay in Orca only. Starting it is startUnit's.
 */
export async function createItem(orca: OrcaAdapter, store: Pick<Store, "append" | "allocate">, a: NewItem): Promise<ItemCreated> {
  const empty = REQUIRED.filter((k) => a[k].trim() === "");
  if (empty.length > 0) return { ok: false, code: "invalid_input", error: `empty: ${empty.join(", ")}` };
  const args = { spec: `${roleLine(a.role ?? "worker")}\n${a.spec}`, run: a.run, ...(a.title ? { title: a.title } : {}), ...(a.deps?.length ? { deps: a.deps } : {}), ...(a.parent ? { parent: a.parent } : {}) };
  const r = await orca.taskCreate(args);
  if (!r.ok) return { ok: false, code: "task_create_failed", error: `task-create 실패 (${r.error.code}: ${r.error.message})`, orcaCode: r.error.code };
  const task = findKey(r.value, ["taskId", "task_id"]) ?? findKey((r.value as { task?: unknown }).task, ["id"]);
  if (!task) return { ok: false, code: "task_create_failed", error: "task-create 영수증에 Task id 가 없다" };
  const alias = store.allocate("i");
  store.append({
    type: "item_created",
    source: "core:item",
    payload: { task, alias, who: a.who, done_when: a.doneWhen, owner_action: 0, run: a.run },
    entity: "task",
    entity_id: task,
  });
  return { ok: true, task, alias };
}

/**
 * Free slots on a Run: live workers against `limit`, with the one load judgment (decision 83).
 * Decision 318: a Dispatch that has finished, by Orca's state or by a worker_done the store holds
 * (a READY-WAIT unit waits on merge approval only), holds no slot.
 */
export async function runSlots(
  orca: OrcaAdapter,
  run: string,
  limit: number,
  sample: LoadSample = sampleLoad(),
  store?: Pick<Store, "events">,
): Promise<number> {
  const w = await orca.workerList({ run, limit: 100 });
  if (!w.ok) throw new Error(`worker-list ${w.error.code}`);
  const done = new Set(store?.events({ type: "worker_done" }).map((e) => e.entity_id) ?? []);
  const live = w.value.rows.filter((r) => r.liveness === "live" && !settled(r) && !done.has(r.dispatchId)).length;
  return capacity({ live, limit, level: judgeLoad(sample).level });
}
