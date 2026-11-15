import { defineEvent, opt, str } from "../define.ts";

export default defineEvent("session_started", {
  session: str,
  role: str,
  tier: opt(str),
  model: str,
  effort: opt(str),
  /** Orca's path-free id of the worktree a session with no Task runs in (decision 273). */
  worktree: opt(str),
});
