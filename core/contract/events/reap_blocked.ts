import { defineEvent, oneOf, refOrcaIdForWorktree, str } from "../define.ts";

export default defineEvent(
  "reap_blocked",
  {
    kind: str,
    ref: str,
    reason: oneOf(
      "uncommitted",
      "unpushed",
      "unpushed_other_patch",
      "task_open",
      "session_alive",
      "evidence_in_worktree",
      "listener",
      "compose_running",
      "docker_unreachable",
      "in_use",
      "archive_hook_failed",
      "remote_host",
      "config_unreadable",
    ),
  },
  { refine: refOrcaIdForWorktree },
);
