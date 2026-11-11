import { defineEvent, int, oneOf, opt, str } from "../define.ts";

// Decision 200: the policy row start_unit picked for a started session and why. Orca owns the
// Dispatch; this row keeps only sangsoe's choice, keyed by the Task.
export default defineEvent("unit_started", {
  dispatch: str,
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
});
