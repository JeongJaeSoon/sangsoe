import { defineEvent, orcaId, str } from "../define.ts";

// A record that an Orca message went out, not a wake-up. dedupe_key notify:<target>:<condition>.
export default defineEvent(
  "notified",
  { msg_id: orcaId, to: str, msg_type: str },
  { dedupe: "notify", dedupeRequired: true },
);
