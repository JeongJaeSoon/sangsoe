import { defineEvent, int, oneOf, opt, str } from "../define.ts";

// Decision 200: the policy row start_unit picked for a start and why, written before worker-start
// so the new session's SessionStart reads it. Orca owns the Dispatch; this row keeps only sangsoe's
// choice, keyed by the Task. A start that then fails leaves its row; the next start's row wins.
export default defineEvent("unit_started", {
  kind: str,
  /** How the row was picked: an explicit kind, the unit's class, or the child role's default. */
  picked_by: oneOf("kind", "class", "role"),
  model: str,
  effort: str,
  advisor: opt(str),
  route: oneOf("orca_flag", "worktree_file", "owner_setting", "none"),
  budget: int,
  budget_per: oneOf("unit", "day"),
  /** Advisor calls already counted against the budget when this start was made. */
  used: int,
  /** Decision 202: the worktree start_unit created for this session. */
  worktree: opt(str),
  /**
   * Decision 202: the plain shell `worktree create` opened there, the only terminal REAPER may close
   * (after every Dispatch in that worktree is released, and only with `setup: none`).
   */
  shell: opt(str),
  /** Whether a repo setup script may still run in `shell`: Orca gives no setup-done signal. */
  setup: opt(oneOf("none", "script", "unknown")),
});
