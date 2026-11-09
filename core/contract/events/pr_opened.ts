import { defineEvent, opt, orcaId, prRef } from "../define.ts";

export default defineEvent("pr_opened", { pr: prRef, task: opt(orcaId) });
