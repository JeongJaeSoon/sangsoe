import { defineEvent, repo, sha, str } from "../define.ts";

export default defineEvent("main_red", { repo, sha, run_id: str }, { needs: "action" });
