import { defineEvent, isoUtc, opt, prRef, who } from "../define.ts";

// at: GitHub's submitted_at (decision 201), absent on rows written before it.
export default defineEvent("pr_changes_requested", { pr: prRef, reviewer: opt(who), at: opt(isoUtc) }, { needs: "action" });
