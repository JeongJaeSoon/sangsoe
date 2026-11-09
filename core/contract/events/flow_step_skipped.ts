import { defineEvent, str } from "../define.ts";

export default defineEvent("flow_step_skipped", { step: str, reason: str });
