import { defineEvent, int, itemNo, opt, orcaId, str, who } from "../define.ts";

// The item is the Orca Task; this row binds its iNNN alias and what Orca does not hold. `run` is a
// pointer, not a copy of state: a Task never changes Run, and Orca has no lookup across Runs, so a
// read with no current Run (plugin timer, brief) learns here which Run to read (decision 216).
export default defineEvent("item_created", {
  task: orcaId,
  alias: itemNo,
  who,
  done_when: str,
  owner_action: int,
  run: opt(orcaId),
  /**
   * Decision 318: sha256 of the task-create args start_unit sent (spec with its role line, title,
   * deps), so a retry of a call the client cut off adopts the Task instead of making another.
   */
  spec_hash: opt(str),
});
