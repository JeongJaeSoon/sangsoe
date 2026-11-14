import { defineEvent, orcaId, str } from "../define.ts";

// Decision 263: `unit_close` closed a finished unit's agent terminal. Orca keeps the Dispatch and its
// state; this row only says sangsoe closed that terminal, keyed by the Dispatch.
export default defineEvent("unit_closed", { dispatch: orcaId, terminal: str }, { dedupeBound: (p) => [p.dispatch], dedupeClosed: true });
