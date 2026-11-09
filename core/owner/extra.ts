import { ContractError, type VerifySpec, verifySpec } from "../contract/index.ts";
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
