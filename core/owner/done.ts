import { createHash } from "node:crypto";
import { dedupeKey, EVENTS, type StoredEvent, type ViewInput } from "../contract/index.ts";
import type { OrcaAdapter, TaskRow } from "../contract/orca.ts";
import { doneBlockers } from "../graph/flow.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import type { Store } from "../store/store.ts";
import { DONE_EVIDENCE, ownerMarks } from "./marks.ts";
import { isOwnerItem, OWNER_DEFAULTS, type OwnerConfig, type OwnerItemFacts } from "./types.ts";

/** The evidence kind of a 완료 press that waits for the session holding the item's Run (decision 317). */
export const DONE_REQUEST = "owner_act:done";
/** The hook found the pressed Task closed by someone else: the press is spent. */
const DONE_SETTLED = "owner_act:done_settled";
/** Orca statuses of a Task still open and not taken by a worker. */
const WAITING: ReadonlySet<string> = new Set(["pending", "ready"]);
const CLOSED: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

export interface OwnerDone {
  readonly task: string;
  readonly alias: string;
  /** Recorded, not closed: the session that holds the item's Run closes the Task (decision 317). */
  readonly status: "pending";
}

/**
 * Every Task with a 완료 press not yet spent → the owner_action seq of that press. A press is spent by
 * the next item_transition of its Task, or by the settle row the hook writes on finding the Task
 * closed some other way, so an item reopened later waits for a new press.
 */
export function ownerDoneRequests(events: readonly StoredEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.type === "item_transition") out.delete(String(e.payload.task));
    if (e.type !== "evidence" || e.entity !== "task" || !e.entity_id) continue;
    if (e.payload.kind === DONE_SETTLED) out.delete(e.entity_id);
    else if (e.payload.kind === DONE_REQUEST && !out.has(e.entity_id)) out.set(e.entity_id, Number(/^owner_action (\d+)$/.exec(String(e.payload.observed))?.[1]));
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
  const blocked = (seq: number) => {
    // Decision 212 ④: the press is the owner_action the owner gate asks for; any other blocker refuses.
    const b = doneBlockers({ ...input, events: store.events() }, f.task, { owner: true, ownerAction: seq });
    return b.length > 0 ? refuse("done_blocked", `${f.alias} cannot be ✅ yet: ${b.join(" · ")}`, "clear what blocks it, then press 완료 again") : null;
  };
  // Pressed again while it waits: nothing more is written, but a blocker that appeared since is said.
  const waiting = ownerDoneRequests(store.events()).get(f.task);
  if (waiting !== undefined) return blocked(waiting) ?? pending;
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
  const refused = blocked(action.seq);
  if (refused) return refused;
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
 * press on a Task of this Run is closed with this Run as caller while the item still reads 🟢 (`ready`,
 * the reading the press required) and nothing blocks it with the press's owner_action. Anything else
 * keeps the request waiting. A Task found closed some other way spends the press. With no verify the
 * press is the evidence; with one the item reads ⏳ 검증 대기 until a probe sees it (decision 181).
 * A closed Task costs no call, so a second prompt does nothing. Returns the aliases closed.
 */
export async function closeOwnerDone(
  d: { readonly orca: Pick<OrcaAdapter, "taskUpdate">; readonly store: Pick<Store, "append" | "events"> },
  a: { readonly run: string; readonly input: ViewInput; readonly rows: readonly TaskRow[]; ready(task: string): boolean; readonly source: string },
  cfg: Pick<OwnerConfig, "waitMinutes"> = OWNER_DEFAULTS,
): Promise<string[]> {
  const asks = ownerDoneRequests(d.store.events());
  const closed: string[] = [];
  for (const [task, action] of asks) {
    const status = a.rows.find((r) => r.id === task)?.status;
    if (status === undefined) continue;
    if (CLOSED.has(status)) {
      d.store.append({
        type: "evidence",
        source: a.source,
        payload: { kind: DONE_SETTLED, observed: `owner_action ${action}, Task ${status}` },
        entity: "task",
        entity_id: task,
        dedupe_key: dedupeKey(EVENTS.evidence, task, DONE_SETTLED, String(action)),
      });
      continue;
    }
    if (!WAITING.has(status) || !a.ready(task)) continue;
    const events = d.store.events();
    if (doneBlockers({ ...a.input, events }, task, { owner: true, ownerAction: action }).length > 0) continue;
    const u = await d.orca.taskUpdate({ id: task, status: "completed", result: "owner_done", run: a.run });
    if (!u.ok) continue;
    d.store.append({
      type: "item_transition",
      source: a.source,
      payload: { task, from: "ready", to: "done", reason: "owner_done" },
      entity: "task",
      entity_id: task,
      dedupe_key: dedupeKey(EVENTS.item_transition, task, "owner_done", String(action)),
    });
    if (!ownerMarks({ events, now: a.input.now }, cfg).get(task)?.verify) {
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
