import { defineEvent, isoUtc, opt, prRef, sha } from "../define.ts";

// merged_at is GitHub's merge time: pr-monitor judges main CI for the repository's newest merge by it.
export default defineEvent("pr_merged", { pr: prRef, merge_sha: sha, merged_at: opt(isoUtc) });
