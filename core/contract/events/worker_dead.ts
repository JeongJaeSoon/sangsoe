import { defineEvent, oneOf, opt, str } from "../define.ts";

// reason: terminal_gone · host_restart (many at once) · start_failed · stop_failure (Orca's
// `errored` stop escalation that is not a usage limit, read by orca-monitor, decision 196).
// cause: auth when that stop's last turn line is Claude Code's lost-login message (decision 237).
export default defineEvent("worker_dead", { reason: str, cause: opt(oneOf("auth")) }, { needs: "judgment" });
