import { createHash } from "node:crypto";
import { dedupeKey, EVENTS, type StoredEvent, type ViewInput } from "../contract/index.ts";
import type { OrcaAdapter, TaskRow } from "../contract/orca.ts";
import { canTransition } from "../contract/transitions.ts";
import { itemStateOf } from "../detect/pr/judge.ts";
import { doneBlockers } from "../graph/flow.ts";
import { type FullTaskRow, snapshotTasks } from "../graph/snapshot.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import type { Store } from "../store/store.ts";
import { DONE_EVIDENCE, ownerMarks } from "./marks.ts";
import { isOwnerItem, OWNER_DEFAULTS, type OwnerConfig, type OwnerItemFacts } from "./types.ts";

/** The evidence kind of a 완료 press that waits for the session holding the item's Run (decision 317). */
export const DONE_REQUEST = "owner_act:done";

export interface OwnerDone {
  readonly task: string;
  readonly alias: string;
  /** Recorded, not closed: the session that holds the item's Run closes the Task (decision 317). */
  readonly status: "pending";
}

/**
 * Every Task with a 완료 press no transition has followed → the owner_action seq of that press. The
 * close's item_transition consumes it, so an item reopened later waits for a new press.
 */
export function ownerDoneRequests(events: readonly StoredEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.type === "item_transition") out.delete(String(e.payload.task));
    else if (e.type === "evidence" && e.payload.kind === DONE_REQUEST && e.entity === "task" && e.entity_id && !out.has(e.entity_id)) {
      out.set(e.entity_id, Number(/^owner_action (\d+)$/.exec(String(e.payload.observed))?.[1]));
    }
  }
  return out;
}

/**
 * The panel "완료" button (decision 91②, row 2): an explicit answer naming exactly one owner item.
 * Orca takes no task-update from the plugin's process (decision 274), so the press is recorded and
 * left for the session that holds the item's Run, whose prompt hook closes it (`closeOwnerDone`).
 */
export async function ownerDone(
  ports: { readonly store: Pick<Store, "append" | "appendOwnerAction" | "events"> },
  input: ViewInput,
  facts: readonly OwnerItemFacts[],
  a: { readonly task: string; readonly session?: string },
): Promise<Result<OwnerDone>> {
  const f = facts.find((x) => x.task === a.task || x.alias === a.task);
  if (!f) return refuse("not_found", `no item ${a.task}`, "press 완료 on an item row");
  if (!isOwnerItem(f)) return refuse("not_owner_item", `${f.alias} is not the owner's`, "the holder closes it");
  if (f.state !== "ready") return refuse("not_ready", `${f.alias} is ${f.state}, not 🟢`, "only an open 🟢 owner item takes 완료");
  const { store } = ports;
  const pending = done({ task: f.task, alias: f.alias, status: "pending" as const });
  if (ownerDoneRequests(store.events()).has(f.task)) return pending;
  const text = `완료 ${f.alias}`;
  const action = store.appendOwnerAction(
    {
      type: "owner_action",
      source: "plugin:panel",
      payload: { origin: "button", summary: text, hash: createHash("sha256").update(text).digest("hex").slice(0, 16), ...(a.session ? { cc_session: a.session } : {}) },
      entity: "task",
      entity_id: f.task,
    },
    text,
  );
  // Decision 212 ④: the press is the owner_action the owner gate asks for; any other blocker refuses.
  const blockers = doneBlockers({ ...input, events: store.events() }, f.task, { owner: true, ownerAction: action.seq });
  if (blockers.length > 0) return refuse("done_blocked", `${f.alias} cannot be ✅ yet: ${blockers.join(" · ")}`, "clear what blocks it, then press 완료 again");
  store.append({
    type: "evidence",
    source: "plugin:panel",
    payload: { kind: DONE_REQUEST, observed: `owner_action ${action.seq}` },
    entity: "task",
    entity_id: f.task,
    dedupe_key: dedupeKey(EVENTS.evidence, f.task, DONE_REQUEST, String(action.seq)),
  });
  return pending;
}

/**
 * Decision 317, from the prompt hook of the session that holds the Run (`deliverOwnRun`): each 완료
 * press on a Task of this Run that is still open is closed with this Run as caller. The blockers are
 * read again with the press's owner_action; one that appeared since keeps the request waiting. With
 * no verify the press is the evidence; with one the item reads ⏳ 검증 대기 until a probe sees it
 * (decision 181). A closed Task costs no call, so a second prompt does nothing. Returns the aliases closed.
 */
export async function closeOwnerDone(
  d: { readonly orca: Pick<OrcaAdapter, "taskUpdate">; readonly store: Pick<Store, "append" | "events"> },
  a: { readonly run: string; readonly rows: readonly TaskRow[]; readonly source: string; readonly now: string },
  cfg: Pick<OwnerConfig, "waitMinutes"> = OWNER_DEFAULTS,
): Promise<string[]> {
  const asks = ownerDoneRequests(d.store.events());
  if (asks.size === 0) return [];
  const tasks = snapshotTasks(a.rows as FullTaskRow[], a.run);
  const closed: string[] = [];
  for (const [task, action] of asks) {
    const from = itemStateOf(a.rows.find((r) => r.id === task)?.status ?? "");
    if (!from || !canTransition(from, "done")) continue;
    const events = d.store.events();
    if (doneBlockers({ orca: { tasks, gates: [] }, events, now: a.now }, task, { owner: true, ownerAction: action }).length > 0) continue;
    const u = await d.orca.taskUpdate({ id: task, status: "completed", result: "owner_done", run: a.run });
    if (!u.ok) continue;
    d.store.append({
      type: "item_transition",
      source: a.source,
      payload: { task, from, to: "done", reason: "owner_done" },
      entity: "task",
      entity_id: task,
      dedupe_key: dedupeKey(EVENTS.item_transition, task, "owner_done"),
    });
    if (!ownerMarks({ events, now: a.now }, cfg).get(task)?.verify) {
      d.store.append({
        type: "evidence",
        source: a.source,
        payload: { kind: DONE_EVIDENCE, observed: `panel button, owner_action ${action}` },
        entity: "task",
        entity_id: task,
        dedupe_key: dedupeKey(EVENTS.evidence, task, DONE_EVIDENCE, String(action)),
      });
    }
    const alias = events.find((e) => e.type === "item_created" && e.payload.task === task)?.payload.alias;
    closed.push(typeof alias === "string" ? alias : task);
  }
  return closed;
}
