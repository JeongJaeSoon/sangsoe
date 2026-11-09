import { defineEvent, opt, prRef, sha, str } from "../define.ts";

export default defineEvent("ci_failed", { pr: opt(prRef), head_sha: opt(sha), run_id: str }, { needs: "action" });
