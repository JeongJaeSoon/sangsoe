import { defineEvent, orcaId, str } from "../define.ts";

// Detectors never close items; they suggest (decision 76 rule 6).
export default defineEvent("close_suggested", { task: orcaId, reason: str }, { needs: "judgment" });
