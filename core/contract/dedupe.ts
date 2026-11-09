import { ContractError, type DedupeRow, type EventDef } from "./define.ts";

// dedupe_key rule (split Q13; docs/architecture.md "코어 계약"): `<prefix>:<target>[:<condition>...]`.
// - <prefix> is the one the event type declares (EventDef.dedupe): its own type name, except the
//   four short prefixes the design already uses: notified → notify, decision_opened → decision,
//   item_ready → ready, edge_added → edge.
// - A prefix belongs to exactly one event type, so two types can never collide on a key, and two
//   writers of the same condition (any source) land on one row through UNIQUE(dedupe_key).
// - Each segment is dedupeSegment(value): Orca ids are opaque and may hold ':' or spaces, and the
//   encoding is injective, so `ready:<task>` for two different tasks can never be the same key.
//   Re-asking a decision appends `:r<n>`.
// - Where the type binds leading segments to the row (dedupeBound: the task, the decision key, the
//   recipient, an edge's ends), the key must start with exactly those segments, encoded; a closed
//   type (edge_added) has nothing after them. So one condition has one spelling and one row.
const KEY = /^([a-z][a-z_]*):([^\s:]+)(:[^\s:]+)*$/;

export const dedupeSegment = (value: string): string => encodeURIComponent(value);

export function checkDedupeKey(def: EventDef, key: string, payload?: unknown, row: DedupeRow = {}): void {
  const m = KEY.exec(key);
  if (!m) throw new ContractError(`dedupe_key ${JSON.stringify(key)}: expected <prefix>:<target>[:<condition>]`);
  if (m[1] !== def.dedupe) {
    throw new ContractError(`dedupe_key ${JSON.stringify(key)}: ${def.type} keys start with "${def.dedupe}:"`);
  }
  if (def.dedupeBound && payload !== undefined) {
    const want = [def.dedupe, ...def.dedupeBound(payload, row).map(dedupeSegment)];
    const got = key.split(":");
    const ok = want.every((s, i) => got[i] === s) && (!def.dedupeClosed || got.length === want.length);
    if (!ok) {
      const shape = `${want.join(":")}${def.dedupeClosed ? "" : "[:<condition>]"}`;
      throw new ContractError(`dedupe_key ${JSON.stringify(key)}: ${def.type} keys are "${shape}"`);
    }
  }
}

export function dedupeKey(def: EventDef, target: string, ...condition: string[]): string {
  const key = [def.dedupe, ...[target, ...condition].map(dedupeSegment)].join(":");
  checkDedupeKey(def, key);
  return key;
}
