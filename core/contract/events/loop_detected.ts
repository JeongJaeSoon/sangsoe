import { defineEvent, str } from "../define.ts";

// Orca's three-failed-starts cutoff on a Dispatch.
export default defineEvent("loop_detected", { reason: str }, { needs: "judgment" });
