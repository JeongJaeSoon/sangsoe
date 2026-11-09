import { defineEvent, opt, prRef, who } from "../define.ts";

export default defineEvent("pr_changes_requested", { pr: prRef, reviewer: opt(who) }, { needs: "action" });
