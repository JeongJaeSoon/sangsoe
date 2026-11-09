import type { Clock } from "./timer.ts";

// The timer-stall detector (decision 83). A timer cannot report that it stopped, so this is never
// a Round: Orca events and panel refreshes poke it, and the core judges from the REAPER's own
// reap_round rows. Pokes are single-flight and at most one check per `minGapMs`.

export const STALL_MIN_GAP_MS = 60_000;

export type StallState = { checks: number; lastAt: number | null; lastError: string | null; last: unknown };

export function stallWatch(check: () => Promise<unknown>, clock: Clock, minGapMs = STALL_MIN_GAP_MS) {
  const state: StallState = { checks: 0, lastAt: null, lastError: null, last: null };
  let busy = false;
  return {
    poke(): void {
      const now = clock.now();
      if (busy || (state.lastAt !== null && now - state.lastAt < minGapMs)) return;
      busy = true;
      state.lastAt = now;
      state.checks += 1;
      void check()
        .then((r) => {
          state.last = r;
          state.lastError = null;
        })
        .catch((e: unknown) => {
          state.lastError = e instanceof Error ? e.message : String(e);
        })
        .finally(() => {
          busy = false;
        });
    },
    state: (): StallState => ({ ...state }),
  };
}
