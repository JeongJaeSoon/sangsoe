import { defineEvent, repo, sha, str } from "../define.ts";

// Kept per repository, not per program (appendix #schema).
export default defineEvent("main_green", { repo, sha, run_id: str });
