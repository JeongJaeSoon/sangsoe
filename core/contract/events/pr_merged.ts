import { defineEvent, prRef, sha } from "../define.ts";

export default defineEvent("pr_merged", { pr: prRef, merge_sha: sha });
