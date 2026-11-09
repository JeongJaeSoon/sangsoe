// Periodic work in the plugin worker (decision 75): one Round per monitor, all on the worker's
// own Node timers. No OS job scheduler, cron or Orca automation runs these.
//
// Round contract (decision 83's hint rule, applied to every monitor):
// - period: a timer tick every `intervalMs`;
// - single-flight: a tick or hint that arrives while the round runs never starts a second one;
// - hint: "run once soon" — hints inside `debounceMs` coalesce into one round, and hints that
//   arrive while a round runs leave exactly one more round for after it;
// - cap: past `capMs` the round's signal aborts, but the next round still waits until it returns.

export type Clock = {
  now(): number;
  every(ms: number, fn: () => void): () => void;
  after(ms: number, fn: () => void): () => void;
};

export const nodeClock: Clock = {
  now: () => Date.now(),
  every(ms, fn) {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  },
  after(ms, fn) {
    const h = setTimeout(fn, ms);
    return () => clearTimeout(h);
  },
};

export type Round = {
  id: string;
  intervalMs: number;
  capMs?: number;
  run(at: number, signal: AbortSignal): void | Promise<void>;
};

export type Trigger = "timer" | "hint";

export type RoundStats = {
  intervalMs: number;
  runs: number;
  errors: number;
  lastError: string | null;
  hints: number;
  timeouts: number;
  lastTrigger: Trigger | null;
  // Measured gaps between consecutive timer ticks (run or skipped), newest last; T2 reads drift here.
  gapsMs: number[];
};

const KEEP_GAPS = 32;
export const HINT_DEBOUNCE_MS = 5_000;

export function startRounds(rounds: readonly Round[], clock: Clock = nodeClock, opts: { debounceMs?: number } = {}) {
  const debounceMs = opts.debounceMs ?? HINT_DEBOUNCE_MS;
  const stats = new Map<string, RoundStats>();
  const hints = new Map<string, () => void>();
  const cancels: (() => void)[] = [];

  for (const r of rounds) {
    const s: RoundStats = {
      intervalMs: r.intervalMs,
      runs: 0,
      errors: 0,
      lastError: null,
      hints: 0,
      timeouts: 0,
      lastTrigger: null,
      gapsMs: [],
    };
    stats.set(r.id, s);
    let last: number | null = null;
    let busy = false;
    let pending = false;
    let cancelDebounce: (() => void) | null = null;
    let cancelCap: (() => void) | null = null;

    const fire = (trigger: Trigger) => {
      if (busy) {
        if (trigger === "hint") pending = true;
        return;
      }
      busy = true;
      s.runs += 1;
      s.lastTrigger = trigger;
      const ctl = new AbortController();
      if (r.capMs !== undefined) {
        cancelCap = clock.after(r.capMs, () => {
          cancelCap = null;
          s.timeouts += 1;
          ctl.abort(new Error(`round ${r.id} passed its ${r.capMs} ms cap`));
        });
      }
      Promise.resolve()
        .then(() => r.run(clock.now(), ctl.signal))
        .catch((e: unknown) => {
          s.errors += 1;
          s.lastError = e instanceof Error ? e.message : String(e);
        })
        .finally(() => {
          cancelCap?.();
          cancelCap = null;
          busy = false;
          if (pending) {
            pending = false;
            hint();
          }
        });
    };

    const hint = () => {
      if (cancelDebounce) return;
      cancelDebounce = clock.after(debounceMs, () => {
        cancelDebounce = null;
        fire("hint");
      });
    };
    hints.set(r.id, () => {
      s.hints += 1;
      hint();
    });

    cancels.push(
      clock.every(r.intervalMs, () => {
        const at = clock.now();
        if (last !== null) s.gapsMs = [...s.gapsMs, at - last].slice(-KEEP_GAPS);
        last = at;
        fire("timer");
      }),
      () => {
        cancelDebounce?.();
        cancelDebounce = null;
        cancelCap?.();
        cancelCap = null;
        pending = false;
      },
    );
  }

  return {
    stats: (): Record<string, RoundStats> => Object.fromEntries(stats),
    /** Asks for one round soon; false when no round has this id. */
    hint: (id: string): boolean => {
      const h = hints.get(id);
      h?.();
      return h !== undefined;
    },
    stop: () => {
      for (const c of cancels) c();
    },
  };
}
