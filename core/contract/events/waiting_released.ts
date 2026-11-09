import { defineEvent, oneOf, str } from "../define.ts";

// dedupe_key waiting_released:<waiting_human seq>: the first signal that saw the release wins (decision 91).
export default defineEvent(
  "waiting_released",
  {
    ref: str,
    outcome: oneOf("answered", "moot"),
    by: oneOf("owner", "button", "unknown"),
    evidence: str,
  },
  { dedupeTarget: (p) => p.ref },
);
