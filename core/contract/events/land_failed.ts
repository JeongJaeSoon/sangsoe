import { defineEvent, opt, prRef, sha, str } from "../define.ts";

export default defineEvent("land_failed", { pr: prRef, head_sha: opt(sha), reason: str }, { needs: "action" });
