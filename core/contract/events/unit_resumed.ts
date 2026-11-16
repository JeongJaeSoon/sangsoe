import { defineEvent, opt, orcaId, str } from "../define.ts";

// Decision 322: start_unit bound a session re-opened with `claude --resume` back to its own Task.
// Orca owns both Dispatches; this row keeps which session went into which terminal, keyed by the Task.
export default defineEvent("unit_resumed", {
  /** The new Dispatch, bound to `terminal`. */
  dispatch: orcaId,
  /** The Dispatch the session held before, abandoned by this resume or before it. */
  from: orcaId,
  /** The Claude Code session id the terminal resumed. */
  session: str,
  terminal: str,
  /** The Task's worktree, the one start_unit made for it. */
  worktree: str,
  run: opt(orcaId),
});
