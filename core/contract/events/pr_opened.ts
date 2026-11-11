import { defineEvent, opt, orcaId, prRef, sha, str } from "../define.ts";

// base and head_sha are the PR's state when pr-monitor first saw it: pr_base_changed compares against base.
// head is the head branch, only when it lives in the PR's own repository: graph sync reads a PR whose
// base is another open PR's head as stacked on it.
export default defineEvent("pr_opened", { pr: prRef, task: opt(orcaId), base: opt(str), head_sha: opt(sha), head: opt(str) });
