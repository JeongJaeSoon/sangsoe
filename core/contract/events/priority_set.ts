import { defineEvent, priority, str } from "../define.ts";

// subject: an Orca task id or lead:<name>.
export default defineEvent("priority_set", { subject: str, value: priority });
