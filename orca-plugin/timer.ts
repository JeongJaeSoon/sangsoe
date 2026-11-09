// Periodic work in the plugin worker (decision 75 라): one Round per monitor, all on the worker's
// own Node timers. No launchd, cron or Orca automation runs these.

export type Clock = {
  now(): number;
  every(ms: number, fn: () => void): () => void;
};

export const nodeClock: Clock = {
  now: () => Date.now(),
  every(ms, fn) {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  },
};

export type Round = {
  id: string;
  intervalMs: number;
  run(at: number): void | Promise<void>;
};

export type RoundStats = {
  intervalMs: number;
  runs: number;
  errors: number;
  lastError: string | null;
  // Measured gaps between consecutive starts, newest last; T2 reads drift from these.
  gapsMs: number[];
};

const KEEP_GAPS = 32;

export function startRounds(rounds: readonly Round[], clock: Clock = nodeClock) {
  const stats = new Map<string, RoundStats>();
  const stops = rounds.map((r) => {
    const s: RoundStats = { intervalMs: r.intervalMs, runs: 0, errors: 0, lastError: null, gapsMs: [] };
    stats.set(r.id, s);
    let last: number | null = null;
    let busy = false;
    return clock.every(r.intervalMs, () => {
      const at = clock.now();
      if (last !== null) s.gapsMs = [...s.gapsMs, at - last].slice(-KEEP_GAPS);
      last = at;
      // A round still running when the next tick fires is skipped, so rounds never overlap.
      if (busy) return;
      busy = true;
      s.runs += 1;
      Promise.resolve()
        .then(() => r.run(at))
        .catch((e: unknown) => {
          s.errors += 1;
          s.lastError = e instanceof Error ? e.message : String(e);
        })
        .finally(() => {
          busy = false;
        });
    });
  });
  return {
    stats: (): Record<string, RoundStats> => Object.fromEntries(stats),
    stop: () => {
      for (const stop of stops) stop();
    },
  };
}
