import { defineEvent, oneOf, str } from "../define.ts";

// Decision 333: a session that came back without --agent (/clear, a resume under a new id) took the
// role of the session that ran before it in the same Orca terminal or worktree. The row says whose.
export default defineEvent(
  "session_continued",
  {
    from: str,
    to: str,
    by: oneOf("terminal", "worktree"),
  },
  { sources: ["SessionStart"] },
);
