import { ContractError, defineEvent, orcaId, str } from "../define.ts";

// A record that an Orca message went out, not a wake-up. dedupe_key notify:<target>:<condition>, where
// <target> is the row's target column (the lead or worker told).
export default defineEvent(
  "notified",
  { msg_id: orcaId, to: str, msg_type: str },
  {
    dedupe: "notify",
    dedupeBound: (_p, row) => {
      if (!row.target) throw new ContractError("notified: the row's target names who was told");
      return [row.target];
    },
  },
);
