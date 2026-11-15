import { type ItemSet, Store, setItemExtra } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

/** Decision 279: an existing item's group, hold or trigger. Orca is not read or written: these are sangsoe's own facts. */
export function itemSet(values: CommandArgs["values"], positionals: readonly string[], ports: { store?: Store } = {}): Outcome {
  const text = (k: string) => (typeof values[k] === "string" ? (values[k] as string) : undefined);
  const hold = text("hold");
  if (hold !== undefined && hold !== "true" && hold !== "false") {
    return { ok: false, refusal: { code: "invalid_input", reason: `hold "${hold}" is not true or false`, fix: "--hold true or --hold false" } };
  }
  const lead = text("lead");
  const trigger = text("trigger");
  const a: ItemSet = {
    item: positionals[0] ?? "",
    ...(lead !== undefined ? { lead } : {}),
    ...(hold !== undefined ? { hold: hold === "true" } : {}),
    ...(trigger !== undefined ? { trigger } : {}),
  };
  const store = ports.store ?? Store.open();
  try {
    return setItemExtra(store, a);
  } finally {
    if (!ports.store) store.close();
  }
}

export default {
  name: "item set",
  summary: "change an existing item's lead group, hold or trigger (one item_extra_set row; decision 279)",
  usage: "<iNNN> [--lead <lead>] [--hold true|false] [--trigger <ISO date|owner/repo#N>]",
  options: {
    lead: { type: "string" },
    hold: { type: "string" },
    trigger: { type: "string" },
  },
  maxPositionals: 1,
  run: ({ values, positionals }) => itemSet(values, positionals),
} satisfies CommandDef;
