import { defineEvent, opt, str } from "../define.ts";

export default defineEvent("session_started", {
  session: str,
  role: str,
  tier: opt(str),
  model: str,
  effort: opt(str),
  /** Orca's path-free id of the worktree a session with no Task runs in (decision 273). */
  worktree: opt(str),
  /** Decision 330: the session's own launch flags and settings folder, which `sangsoe restart` passes again. */
  launch_agent: opt(str),
  launch_name: opt(str),
  launch_model: opt(str),
  launch_effort: opt(str),
  config_dir: opt(str),
});
