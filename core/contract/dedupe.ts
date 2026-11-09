import { ContractError, type EventDef } from "./define.ts";

// dedupe_key rule (split Q13; docs/architecture.md "코어 계약"): `<prefix>:<target>[:<condition>...]`.
// - <prefix> is the one the event type declares (EventDef.dedupe): its own type name, except the
//   four short prefixes the design already uses: notified → notify, decision_opened → decision,
//   item_ready → ready, edge_added → edge.
// - A prefix belongs to exactly one event type, so two types can never collide on a key, and two
//   writers of the same condition (any source) land on one row through UNIQUE(dedupe_key).
// - <target> is non-empty; segments carry no whitespace. Re-asking a decision appends `:r<n>`.
// - Where the type derives <target> from its payload (dedupeTarget), the key's second segment must
//   equal it; targets never hold ':' (Orca ids and decision keys refuse it), so segments are unambiguous.
const KEY = /^([a-z][a-z_]*):([^\s:]+)(:[^\s:]+)*$/;

export function checkDedupeKey(def: EventDef, key: string, payload?: unknown): void {
  const m = KEY.exec(key);
  if (!m) throw new ContractError(`dedupe_key ${JSON.stringify(key)}: expected <prefix>:<target>[:<condition>]`);
  if (m[1] !== def.dedupe) {
    throw new ContractError(`dedupe_key ${JSON.stringify(key)}: ${def.type} keys start with "${def.dedupe}:"`);
  }
  if (def.dedupeTarget && payload !== undefined) {
    const want = def.dedupeTarget(payload);
    if (key.split(":")[1] !== want) {
      throw new ContractError(`dedupe_key ${JSON.stringify(key)}: ${def.type} keys start with "${def.dedupe}:${want}"`);
    }
  }
}

export function dedupeKey(def: EventDef, target: string, ...condition: string[]): string {
  const key = [def.dedupe, target, ...condition].join(":");
  checkDedupeKey(def, key);
  return key;
}
