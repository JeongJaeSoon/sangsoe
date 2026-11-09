import { defineEvent, oneOf, opt, str } from "../define.ts";

export default defineEvent("reap_blocked", {
  kind: opt(str),
  ref: str,
  reason: oneOf("uncommitted", "unpushed", "unpushed_other_patch", "in_use", "archive_hook_failed", "remote_host"),
});
