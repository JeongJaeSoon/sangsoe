import { defineEvent, int, itemNo, orcaId, str, who } from "../define.ts";

// The item is the Orca Task; this row only binds its iNNN alias and what Orca does not hold.
export default defineEvent("item_created", {
  task: orcaId,
  alias: itemNo,
  who,
  done_when: str,
  owner_action: int,
});
