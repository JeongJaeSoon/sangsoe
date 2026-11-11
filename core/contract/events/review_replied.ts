import { defineEvent, isoUtc, opt, prRef, who } from "../define.ts";

// at: GitHub's created_at (decision 201), absent on rows written before it.
export default defineEvent("review_replied", { pr: prRef, by: who, at: opt(isoUtc) });
