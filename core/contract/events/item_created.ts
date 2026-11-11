import { defineEvent, int, itemNo, opt, orcaId, str, who } from "../define.ts";

// The item is the Orca Task; this row only binds its iNNN alias and what Orca does not hold.
// `run` names the Task's Run, so a read with no current Run (plugin timer, brief) knows to read it (decision 216).
export default defineEvent("item_created", {
  task: orcaId,
  alias: itemNo,
  who,
  done_when: str,
  owner_action: int,
  run: opt(orcaId),
});
