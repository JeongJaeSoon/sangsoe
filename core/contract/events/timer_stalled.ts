import { defineEvent, oneOf, str } from "../define.ts";

export default defineEvent("timer_stalled", { kind: oneOf("reaper"), reason: str }, { needs: "judgment" });
