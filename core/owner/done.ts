import { createHash } from "node:crypto";
import type { ViewInput } from "../contract/index.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import type { Store } from "../store/store.ts";
import { DONE_EVIDENCE, ownerMarks } from "./marks.ts";
import { isOwnerItem, OWNER_DEFAULTS, type OwnerConfig, type OwnerItemFacts } from "./types.ts";

export interface OwnerDone {
  readonly task: string;
  readonly alias: string;
  /** ✅ 🔍 "오너 완료 표시 · 검증 대기": the item has a verify and no probe has seen it true yet. */
  readonly evidenceShort: boolean;
}

/**
 * The panel "완료" button (decision 91②, row 2): an explicit answer naming exactly one owner item,
 * so it closes the item at once. Orca's task-update goes first; item_transition records it after.
 * With no verify the button is the evidence; with a verify and no probe true yet the item is ✅ 🔍
 * and a later probe inside verify.grace_hours lifts the 🔍.
 */
export async function ownerDone(
  ports: { readonly orca: Pick<OrcaAdapter, "taskUpdate">; readonly store: Pick<Store, "append" | "appendOwnerAction"> },
  input: ViewInput,
  facts: readonly OwnerItemFacts[],
  a: { readonly task: string; readonly session?: string },
  cfg: Pick<OwnerConfig, "waitMinutes"> = OWNER_DEFAULTS,
): Promise<Result<OwnerDone>> {
  const f = facts.find((x) => x.task === a.task || x.alias === a.task);
  if (!f) return refuse("not_found", `no item ${a.task}`, "press 완료 on an item row");
  if (!isOwnerItem(f)) return refuse("not_owner_item", `${f.alias} is not the owner's`, "the holder closes it");
  if (f.state !== "ready") return refuse("not_ready", `${f.alias} is ${f.state}, not 🟢`, "only an open 🟢 owner item takes 완료");
  const { orca, store } = ports;
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
  const r = await orca.taskUpdate({ id: f.task, status: "completed", result: "owner_done" });
  if (!r.ok) return refuse("orca_error", `task-update ${f.task}: ${r.error.code} ${r.error.message}`, "press 완료 again once Orca answers");
  store.append({ type: "item_transition", source: "plugin:panel", payload: { task: f.task, from: "ready", to: "done", reason: "owner_done" }, entity: "task", entity_id: f.task });
  const m = ownerMarks(input, cfg).get(f.task);
  if (!m?.verify) {
    store.append({
      type: "evidence",
      source: "plugin:panel",
      payload: { kind: DONE_EVIDENCE, observed: `panel button, owner_action ${action.seq}` },
      entity: "task",
      entity_id: f.task,
    });
  }
  return done({ task: f.task, alias: f.alias, evidenceShort: Boolean(m?.verify) && !m?.verified });
}
