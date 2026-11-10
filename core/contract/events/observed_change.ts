import { defineEvent, opt, orcaId, str } from "../define.ts";

// Written only for a Dispatch whose workspace has two or more live terminals, where ps times do not
// tell which one moved (P10, decision 196); names the field that changed, not its value.
export default defineEvent("observed_change", { task: opt(orcaId), field: str });
