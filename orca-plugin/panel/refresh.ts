// When the panel re-reads by itself (decision 205, amending 198 ①): the worker's store.changed push
// asks for one read soon, and the interval stays for what only Orca changed. The worker's round
// rules apply: one read at a time, a push during a read leaves one more, and pushes in the window
// after the first one join it rather than restarting it, so a stream of writes cannot starve reads.
import { type Clock, nodeClock, startRounds } from "../timer.ts";
import { REFRESH_MS } from "./view.ts";

/** How soon after a store write the panel reads: the window pushes coalesce into. */
export const STORE_HINT_MS = 2_000;

export function panelReads(o: { read: () => Promise<void>; may: () => boolean; clock?: Clock }) {
  const rounds = startRounds([{ id: "read", intervalMs: REFRESH_MS, run: () => (o.may() ? o.read() : undefined) }], o.clock ?? nodeClock, {
    debounceMs: STORE_HINT_MS,
  });
  return { changed: () => void rounds.hint("read"), stop: rounds.stop };
}
