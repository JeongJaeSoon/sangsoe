import { defineEvent, match, oneOf, str } from "../define.ts";

// dedupe_key waiting_released:<waiting_human seq>: the first signal that saw the release wins (decision 91).
export default defineEvent(
  "waiting_released",
  {
    ref: match(/^[1-9][0-9]*$/, "seq of the waiting_human row"),
    outcome: oneOf("answered", "moot"),
    by: oneOf("owner", "button", "unknown"),
    evidence: str,
  },
  { dedupeBound: (p) => [p.ref], dedupeClosed: true },
);
