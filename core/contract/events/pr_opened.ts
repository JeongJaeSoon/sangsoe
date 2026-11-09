import { defineEvent, opt, orcaId, prRef, sha, str } from "../define.ts";

// base and head_sha are the PR's state when pr-monitor first saw it: pr_base_changed compares against base.
export default defineEvent("pr_opened", { pr: prRef, task: opt(orcaId), base: opt(str), head_sha: opt(sha) });
