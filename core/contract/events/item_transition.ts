import { defineEvent, oneOf, orcaId, str } from "../define.ts";
import { ITEM_STATES } from "../transitions.ts";

const state = oneOf(...ITEM_STATES);

// Written after the Orca task-update that made the change; store.append refuses pairs the table forbids.
export default defineEvent("item_transition", { task: orcaId, from: state, to: state, reason: str });
