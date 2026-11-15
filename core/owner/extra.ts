import { ContractError, type VerifySpec, verifySpec } from "../contract/index.ts";
import { foldFacts } from "../graph/facts.ts";
import { triggerKind } from "../graph/ready.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import type { Appended, Store } from "../store/store.ts";

export interface OwnerExtra {
  readonly verify?: VerifySpec;
  readonly cmdHint?: string;
}

/** Checks item_create's `verify` and `cmd_hint` inputs before any Task exists. */
export function parseOwnerExtra(verify: unknown, cmdHint: unknown): { ok: true; value: OwnerExtra } | { ok: false; error: string } {
  const out: { verify?: VerifySpec; cmdHint?: string } = {};
  if (verify !== undefined) {
    try {
      out.verify = verifySpec(verify, "verify");
    } catch (e) {
      return { ok: false, error: e instanceof ContractError ? e.message : String(e) };
    }
  }
  if (cmdHint !== undefined) {
    if (typeof cmdHint !== "string" || cmdHint.trim() === "") return { ok: false, error: "cmd_hint: a non-empty command prefix" };
    out.cmdHint = cmdHint.trim();
  }
  return { ok: true, value: out };
}

export interface ItemSet {
  /** iNNN or the Task id. */
  readonly item: string;
  /** The lead group the brief lists the item under. */
  readonly lead?: string;
  readonly hold?: boolean;
  /** A date (ISO) or a PR (`owner/repo#N`): the two triggers a script reads (decision 32). */
  readonly trigger?: string;
}

export interface ItemSetDone {
  readonly task: string;
  readonly alias: string;
  readonly set: { readonly lead?: string; readonly hold?: boolean; readonly trigger?: string };
}

/**
 * Decision 279: `sangsoe item set`. Changes an existing item's group, hold or trigger with one
 * item_extra_set row; the views fold the latest of each field, so nothing is rewritten. A trigger
 * that is neither a date nor a PR is refused: this entrance writes no trigger a script cannot read.
 */
export function setItemExtra(store: Pick<Store, "append" | "events">, a: ItemSet): Result<ItemSetDone> {
  const facts = foldFacts(store.events());
  const task = facts.aliases.get(a.item) ?? a.item;
  const alias = facts.items.get(task)?.alias;
  if (alias === undefined) return refuse("not_found", `no item ${a.item}`, "name an item by its iNNN or Task id");
  const lead = a.lead?.trim();
  if (lead === "") return refuse("invalid_input", "lead is empty", "lead is the lead group's name, not empty");
  const kind = a.trigger === undefined ? undefined : triggerKind(a.trigger);
  if (kind === "text") return refuse("invalid_trigger", `trigger ${JSON.stringify(a.trigger)} is neither a date nor a PR`, "give an ISO date (2026-12-01 or 2026-12-01T09:00Z) or owner/repo#N");
  // The store keys a PR in lower case, whatever case GitHub or the caller spells the repository in.
  const trigger = kind === "pr" ? a.trigger?.toLowerCase() : a.trigger;
  const set = { ...(lead !== undefined ? { lead } : {}), ...(a.hold !== undefined ? { hold: a.hold } : {}), ...(trigger !== undefined ? { trigger } : {}) };
  if (Object.keys(set).length === 0) return refuse("invalid_input", "nothing to set", "give at least one of lead, hold and trigger");
  store.append({ type: "item_extra_set", source: "core:item", payload: { task, ...set }, entity: "task", entity_id: task });
  return done({ task, alias, set });
}

/** One item_extra_set row with the item's verify and cmd_hint; nothing when neither is given. */
export function recordOwnerExtra(store: Pick<Store, "append">, task: string, x: OwnerExtra, source = "core:item"): Appended | null {
  if (!x.verify && !x.cmdHint) return null;
  return store.append({
    type: "item_extra_set",
    source,
    payload: { task, ...(x.verify ? { verify: x.verify } : {}), ...(x.cmdHint ? { cmd_hint: x.cmdHint } : {}) },
    entity: "task",
    entity_id: task,
  });
}
