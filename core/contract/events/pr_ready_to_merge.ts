import { defineEvent, prRef } from "../define.ts";

export default defineEvent("pr_ready_to_merge", { pr: prRef });
