import { defineEvent, str } from "../define.ts";

// reason: stop_failure (hook) · host_restart (many at once) · start_failed.
export default defineEvent("worker_dead", { reason: str }, { needs: "judgment" });
