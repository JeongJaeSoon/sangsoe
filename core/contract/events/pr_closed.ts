import { defineEvent, prRef } from "../define.ts";

// Closed without a merge.
export default defineEvent("pr_closed", { pr: prRef });
