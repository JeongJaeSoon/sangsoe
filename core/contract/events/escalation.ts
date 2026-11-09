import { defineEvent, opt, orcaId, str } from "../define.ts";

export default defineEvent("escalation", { to: str, msg_id: opt(orcaId), reason: str }, { needs: "judgment" });
