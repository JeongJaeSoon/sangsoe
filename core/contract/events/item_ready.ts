import { defineEvent, orcaId } from "../define.ts";

// A record that the ready view newly listed the item and its lead was told; it writes no state.
// dedupe_key ready:<task>:<edge-set hash>.
export default defineEvent("item_ready", { task: orcaId }, { dedupe: "ready", dedupeTarget: (p) => p.task });
