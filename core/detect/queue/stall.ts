import { dedupeKey, EVENTS, type StoredEvent } from "../../contract/index.ts";
import type { Planned } from "../monitor.ts";

export const STALL_SOURCE = "monitor:stall";
const ROOTS_FAILED_RUN = 3;

/**
 * Decision 83: the REAPER timer is judged stalled from its own reap_round rows, never from the
 * timer — the last `trigger=timer` row older than 3× its period, or `roots_ok=false` three rounds
 * running. Each key is bound to the row that started the stall, so one stall writes once and a
 * later stall writes again. No reap_round row at all is unknown: nothing is judged. While Orca is
 * closed no timer runs by design (decision 182), so the age counts from `openedAt`, the time this
 * worker's runner opened, when that is later than the last timer row.
 */
export function judgeStall(events: readonly StoredEvent[], now: number, periodMs: number, openedAt = Number.NEGATIVE_INFINITY): Planned[] {
  const rounds = events.filter((e) => e.type === "reap_round");
  const out: Planned[] = [];
  const lastTimer = rounds.findLast((e) => e.payload.trigger === "timer");
  const since = lastTimer ? Math.max(Date.parse(lastTimer.ts), openedAt) : 0;
  if (lastTimer && now - since > 3 * periodMs) {
    const minutes = Math.round((now - since) / 60_000);
    out.push(stalled(`no timer round for ${minutes} min (period ${Math.round(periodMs / 60_000)} min)`, "age", lastTimer.seq));
  }
  const tail = rounds.slice(-ROOTS_FAILED_RUN);
  if (tail.length === ROOTS_FAILED_RUN && tail.every((e) => e.payload.roots_ok === false)) {
    let start = rounds.length - ROOTS_FAILED_RUN;
    while (start > 0 && rounds[start - 1]?.payload.roots_ok === false) start--;
    out.push(stalled(`roots_ok=false ${ROOTS_FAILED_RUN} rounds running`, "roots", rounds[start]?.seq ?? 0));
  }
  return out;
}

function stalled(reason: string, cause: "age" | "roots", since: number): Planned {
  return {
    type: "timer_stalled",
    source: STALL_SOURCE,
    payload: { kind: "reaper", reason },
    dedupe_key: dedupeKey(EVENTS.timer_stalled, "reaper", cause, String(since)),
  };
}
