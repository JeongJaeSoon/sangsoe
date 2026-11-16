import { defineEvent, int } from "../define.ts";

// Decision 329: a pr-monitor round that stopped with watched repositories left, at its own walk
// budget or at the timer's cap. What it found before the stop is written; the left ones go first next round.
export default defineEvent(
  "monitor_round_truncated",
  { repos_done: int, repos_left: int, elapsed_ms: int },
  { sources: ["pr-monitor"] },
);
