import { defineEvent, int, oneOf, refOrcaIdForWorktree, str } from "../define.ts";

// Only REAPER writes it; grace and two-consecutive-rounds are counted from these rows.
export default defineEvent(
  "reap_candidate",
  { kind: str, ref: str, round: int, state: oneOf("seen", "cleared") },
  { refine: refOrcaIdForWorktree },
);
