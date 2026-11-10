import { defineEvent, str } from "../define.ts";

// reason: host_restart (many at once) · start_failed · stop_failure (no writer yet: Orca's stopped-on-error escalation, read by orca-monitor, decision 193).
export default defineEvent("worker_dead", { reason: str }, { needs: "judgment" });
