import { defineEvent, opt, orcaId, str } from "../define.ts";

// Fallback path only, used when probe P10 fails (decision 87); names the field that changed, not its value.
export default defineEvent("observed_change", { task: opt(orcaId), field: str });
