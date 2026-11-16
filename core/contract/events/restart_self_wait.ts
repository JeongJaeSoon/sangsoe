import { defineEvent, int, oneOf } from "../define.ts";

// Decision 330: `sangsoe restart` opening the terminal that waits for its caller's claude (`pid`) to end
// and resumes it. `subject` the session; `target` the terminal once Orca names it. `trying` is written
// before the create, `opened` or `refused` after it; the latest row for a pid and session decides
// whether a later run may open another. Its own type, not a signal kind: a core from before 330, still
// running while sessions restart, reads a type it does not know but throws on a kind it does not list.
export default defineEvent(
  "restart_self_wait",
  { pid: int, outcome: oneOf("trying", "opened", "refused") },
  { sources: ["cli:restart"] },
);
