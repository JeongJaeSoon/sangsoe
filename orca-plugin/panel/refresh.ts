// When the panel re-reads by itself (decision 205, amending 198 ①): the worker's store.changed push
// asks for one read soon, and the interval stays for what only Orca changed. The worker's round
// rules apply: one read at a time, a push during a read leaves one more, and pushes in the window
// after the first one join it rather than restarting it, so a stream of writes cannot starve reads.
import { type Clock, nodeClock, startRounds } from "../timer.ts";
import { PARTS, type PartName, STALE_MS } from "./resources.ts";
import { REFRESH_MS } from "./view.ts";

/** How soon after a store write the panel reads: the window pushes coalesce into. */
export const STORE_HINT_MS = 2_000;

/** `tick` runs on each interval tick only, not on a push, whether or not the panel itself reads (decision 257). */
export function panelReads(o: { read: () => Promise<void>; may: () => boolean; tick?: () => void; clock?: Clock }) {
  const run = (_at: number, _signal: AbortSignal, trigger: "timer" | "hint") => {
    if (trigger === "timer") o.tick?.();
    return o.may() ? o.read() : undefined;
  };
  const rounds = startRounds([{ id: "read", intervalMs: REFRESH_MS, run }], o.clock ?? nodeClock, { debounceMs: STORE_HINT_MS });
  return { changed: () => void rounds.hint("read"), stop: rounds.stop };
}

/**
 * What the 리소스 section's tick asks. 정리 후보 costs seconds and one or two GitHub calls per card,
 * so it is read only when its last read would pass STALE_MS before the next tick: often enough that
 * 정리 never locks while the section stays open, rarely enough to cost what it did before.
 */
export function tickParts(now: number, candidatesAt: number): readonly PartName[] {
  return now - candidatesAt + REFRESH_MS >= STALE_MS ? PARTS : ["load", "made"];
}

/**
 * Decision 257: the 리소스 section reads on the panel's own interval tick (no timer of its own) while
 * `shown()`, the section open and the panel visible; folded or hidden, a tick reads nothing.
 * Becoming shown reads at once ("show"). `sync` is called after anything that may change `shown()`.
 * A tick or a show while a read runs, or while `may()` says no, reads nothing.
 */
export function foldReads(o: { read: (why: "show" | "tick") => Promise<void>; may: () => boolean; shown: () => boolean }) {
  let was = false;
  let flight: Promise<void> | null = null;
  let stopped = false;
  const once = (why: "show" | "tick") => {
    if (stopped || flight || !o.may()) return;
    flight = Promise.resolve()
      .then(() => o.read(why))
      .catch(() => undefined)
      .finally(() => {
        flight = null;
      });
  };
  return {
    sync(): void {
      const on = o.shown();
      if (on && !was) once("show");
      was = on;
    },
    tick(): void {
      if (o.shown()) once("tick");
    },
    stop: async (): Promise<void> => {
      stopped = true;
      await flight;
    },
  };
}
