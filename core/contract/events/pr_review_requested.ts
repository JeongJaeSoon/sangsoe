import { defineEvent, opt, prRef, who } from "../define.ts";

export default defineEvent("pr_review_requested", { pr: prRef, reviewer: opt(who) });
