import { defineEvent, str } from "../define.ts";

// reason: terminal_gone · host_restart (many at once) · start_failed · stop_failure (Orca's
// `errored` stop escalation that is not a usage limit, read by orca-monitor, decision 196).
export default defineEvent("worker_dead", { reason: str }, { needs: "judgment" });
