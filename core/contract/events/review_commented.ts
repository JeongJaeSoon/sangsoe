import { defineEvent, isoUtc, opt, prRef, who } from "../define.ts";

// at: GitHub's created_at (decision 201), absent on rows written before it.
export default defineEvent("review_commented", { pr: prRef, reviewer: who, at: opt(isoUtc) }, { needs: "action" });
