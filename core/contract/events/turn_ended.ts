import { defineEvent, int, opt, str } from "../define.ts";

// context_tokens lets restart_due compare the first call after a compaction with the one before it.
export default defineEvent("turn_ended", { session: str, context_tokens: opt(int) });
