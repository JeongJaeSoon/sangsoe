import { defineEvent, prRef } from "../define.ts";

// Open again after a pr_closed (decision 216): the latest of the two says whether the PR is closed.
export default defineEvent("pr_reopened", { pr: prRef });
