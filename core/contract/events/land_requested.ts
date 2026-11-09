import { defineEvent, opt, prRef, sha, str } from "../define.ts";

// reason merge_on_approval: one of the four conditions was false, so the merge waits for approval.
export default defineEvent("land_requested", { pr: prRef, head_sha: sha, reason: opt(str) });
