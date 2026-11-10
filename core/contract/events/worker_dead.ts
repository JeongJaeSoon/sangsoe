import { defineEvent, str } from "../define.ts";

// reason: host_restart (many at once) · start_failed · stop_failure (no writer: the StopFailure hook is not registered, decision 177).
export default defineEvent("worker_dead", { reason: str }, { needs: "judgment" });
