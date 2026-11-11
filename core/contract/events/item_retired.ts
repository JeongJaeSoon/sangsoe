import { defineEvent, orcaId, str, who } from "../define.ts";

// Decision 223: the owner or a lead retires a completed item whose PR closed without a merge. Orca's
// Task stays completed (no transition leaves done); this row is the only record, and `by`·`reason` its audit.
export default defineEvent("item_retired", { task: orcaId, by: who, reason: str }, { dedupeBound: (p) => [p.task], dedupeClosed: true });
