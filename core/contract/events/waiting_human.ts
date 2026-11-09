import { defineEvent, opt, str } from "../define.ts";

// Permission or input wait seen by a hook.
export default defineEvent("waiting_human", { session: str, tool: opt(str), excerpt: opt(str) }, { needs: "action" });
